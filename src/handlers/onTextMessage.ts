import { Context, Markup } from "telegraf";
import { Chat, Message } from "telegraf/types";
import { useThreads } from "../threads.ts";
import { ConfigChatType } from "../types.ts";
import { syncButtons, useConfig } from "../config.ts";
import { log } from "../helpers.ts";
import {
  addToHistory,
  forgetHistoryOnTimeout,
  forgetHistory,
  initThread,
} from "../helpers/history.ts";
import { rememberSave, isRememberCommand, stripRememberPrefix } from "../helpers/memory.ts";
import { setLastCtx } from "../helpers/lastCtx.ts";
import { addOauthToThread, ensureAuth } from "../helpers/google.ts";
import { generateButtonsFromAgent, requestGptAnswer } from "../helpers/gpt.ts";
import checkAccessLevel from "./access.ts";
import resolveChatButtons from "./resolveChatButtons.ts";
import { editTelegramMessage, sendTelegramMessage } from "../telegram/send.ts";

// Track active responses per chat to allow cancellation
interface ActiveResponse {
  abortController: AbortController;
  buttonsAbortController?: AbortController;
  isCompleted: boolean;
}

const activeResponses = new Map<number, ActiveResponse>();

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default async function onTextMessage(
  ctx: Context & { secondTry?: boolean },
  next?: () => Promise<void> | void,
  callback?: (msg: Message.TextMessage) => Promise<void> | void,
) {
  setLastCtx(ctx);

  const access = await checkAccessLevel(ctx);
  if (!access) return;
  const { msg, chat } = access;

  const chatTitle = (ctx.message?.chat as Chat.TitleChat).title || "";
  const chatId = msg.chat.id;
  const answerId = msg.message_id?.toString() || "";

  log({
    msg: msg.text,
    logLevel: "info",
    chatId,
    answerId,
    chatTitle,
    role: "user",
    username: msg?.from?.username,
  });

  // ensure thread exists before processing buttons
  const thread = initThread(msg, chat);

  const extraMessageParams = ctx.message?.message_id
    ? { reply_to_message_id: ctx.message?.message_id }
    : {};

  // may replace msg.text
  const buttonResponse = await resolveChatButtons(ctx, msg, chat, thread, extraMessageParams);
  if (buttonResponse) return buttonResponse;

  const originalText = msg.text ?? "";
  const textWithoutPrefix = chat.prefix
    ? originalText.replace(new RegExp(`^${escapeRegExp(chat.prefix)}[\\s\\p{P}]*`, "iu"), "")
    : originalText;

  if (chat.chatParams?.vector_memory && isRememberCommand(textWithoutPrefix)) {
    const text = stripRememberPrefix(textWithoutPrefix);
    const confirmation = await rememberSave({ text, msg, chat });
    await sendTelegramMessage(msg.chat.id, confirmation, undefined, ctx, chat);
    return;
  }

  // addToHistory should be after replace msg.text
  addToHistory(msg, chat);
  forgetHistoryOnTimeout(chat, msg);

  // Cancel any existing response for this chat
  const existingResponse = activeResponses.get(chatId);
  if (existingResponse) {
    log({
      msg: "cancelling previous response",
      chatId,
      answerId,
      chatTitle: (msg.chat as Chat.TitleChat).title,
      role: "system",
      username: msg?.from?.username,
      logLevel: "debug",
    });
    if (!existingResponse.isCompleted) {
      existingResponse.abortController.abort();
      existingResponse.buttonsAbortController?.abort();
    }
    activeResponses.delete(chatId);
  }

  // Create a new abort controller for this response
  const abortController = new AbortController();

  // Start responding immediately
  const responsePromise = answerToMessage(ctx, msg, chat, {
    ...extraMessageParams,
    signal: abortController.signal,
  });

  // Store the active response for potential cancellation
  const activeResponse: ActiveResponse = {
    abortController,
    isCompleted: false,
  };
  activeResponses.set(chatId, activeResponse);

  responsePromise
    .then((msgSent) => {
      if (msgSent && typeof callback === "function") {
        return callback(msgSent);
      }
    })
    .catch((error) => {
      // Ignore errors from aborted requests
      if (!abortController.signal.aborted) {
        console.error("Error in response handler:", error);
      }
    })
    .finally(() => {
      const currentResponse = activeResponses.get(chatId);
      if (currentResponse === activeResponse) {
        activeResponse.isCompleted = true;
        activeResponses.delete(chatId);
      }
    });
}

export async function answerToMessage(
  ctx: Context & { secondTry?: boolean },
  msg: Message.TextMessage,
  chat: ConfigChatType,
  extraMessageParams: Record<string, unknown> & { signal?: AbortSignal },
): Promise<Message.TextMessage | undefined> {
  if (
    useConfig().auth.oauth_google?.client_id ||
    useConfig().auth.google_service_account?.private_key
  ) {
    const authClient = await ensureAuth(msg.from?.id || 0);
    addOauthToThread(authClient, useThreads(), msg);

    if (chat.buttonsSync && msg.text === "sync" && msg) {
      let syncResult: Message.TextMessage | undefined;
      await ctx.persistentChatAction("typing", async () => {
        if (!msg) return;
        const buttons = await syncButtons(chat, authClient);
        if (!buttons) {
          syncResult = await sendTelegramMessage(
            msg.chat.id,
            "Ошибка синхронизации",
            undefined,
            ctx,
            chat,
          );
          return;
        }

        const extraParams = Markup.keyboard(buttons.map((b) => b.name)).resize();
        const answer = `Готово: ${buttons.map((b) => b.name).join(", ")}`;
        syncResult = await sendTelegramMessage(msg.chat.id, answer, extraParams, ctx, chat);
      });
      return syncResult;
    }
  }

  try {
    let msgSent: Message.TextMessage | undefined;
    await ctx.persistentChatAction("typing", async () => {
      if (!msg || extraMessageParams.signal?.aborted) {
        return;
      }

      const responseFormat = chat.chatParams?.responseButtons
        ? {
            type: "json_schema" as const,
            json_schema: {
              name: "response",
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  message: { type: "string" },
                  buttons: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        name: { type: "string", description: "Short name" },
                        prompt: { type: "string" },
                      },
                      required: ["name", "prompt"],
                    },
                  },
                },
                required: ["message", "buttons"],
              },
            },
          }
        : undefined;

      const res = await requestGptAnswer(msg, chat, ctx, {
        signal: extraMessageParams.signal,
        responseFormat,
      });

      if (extraMessageParams.signal?.aborted) {
        return;
      }

      const thread = useThreads()[msg.chat.id];
      const text = res?.content || "бот не ответил";
      const extraParams: Record<string, unknown> = {
        ...extraMessageParams,
      };
      const buttons = res?.buttons || chat.buttonsSynced || chat.buttons;
      thread.dynamicButtons = res?.buttons;
      if (buttons) {
        const extraParamsButtons = Markup.keyboard(buttons.map((b) => b.name)).resize();
        Object.assign(extraParams, extraParamsButtons);
      }
      const chatTitle = (msg.chat as Chat.TitleChat).title;
      const answerId = msg.message_id?.toString() || "";
      log({
        msg: text,
        logLevel: "info",
        chatId: msg.chat.id,
        answerId,
        chatTitle,
        role: "system",
      });
      msgSent = await sendTelegramMessage(msg.chat.id, text, extraParams, ctx, chat);
      if (msgSent?.chat.id) useThreads()[msgSent.chat.id].msgs.push(msgSent);

      if (chat.chatParams?.responseButtonsAgent && msgSent && !res?.buttons?.length) {
        const buttonsAbortController = new AbortController();
        const activeResponse = activeResponses.get(msg.chat.id);
        if (activeResponse) {
          activeResponse.buttonsAbortController = buttonsAbortController;
        }
        await applyResponseButtonsAgent({
          answerText: msgSent.text || text,
          baseExtraParams: extraParams,
          chat,
          ctx,
          msg,
          originalMessage: msgSent,
          signal: buttonsAbortController.signal,
          thread,
        });
        const currentResponse = activeResponses.get(msg.chat.id);
        if (currentResponse?.buttonsAbortController === buttonsAbortController) {
          currentResponse.buttonsAbortController = undefined;
        }
      }
    });
    return msgSent;
  } catch (e) {
    const error = e as { message: string };
    console.log("error:", error);
    await ctx.persistentChatAction("typing", async () => {});
    if (ctx.secondTry) return;
    if (!ctx.secondTry && error.message.includes("context_length_exceeded")) {
      ctx.secondTry = true;
      forgetHistory(msg.chat.id);
      void onTextMessage(ctx);
    }
    return await sendTelegramMessage(
      msg.chat.id,
      `${error.message}${ctx.secondTry ? "\n\nПовторная отправка последнего сообщения..." : ""}`,
      extraMessageParams,
      ctx,
      chat,
    );
  }
}

async function applyResponseButtonsAgent({
  answerText,
  baseExtraParams,
  chat,
  ctx,
  msg,
  originalMessage,
  signal,
  thread,
}: {
  answerText: string;
  baseExtraParams: Record<string, unknown>;
  chat: ConfigChatType;
  ctx: Context;
  msg: Message.TextMessage;
  originalMessage: Message.TextMessage;
  signal?: AbortSignal;
  thread: ReturnType<typeof useThreads>[number];
}) {
  if (signal?.aborted) return;

  try {
    const generatedButtons = await generateButtonsFromAgent(answerText, msg, { signal });
    if (!generatedButtons?.length) return;

    if (signal?.aborted) return;

    thread.dynamicButtons = generatedButtons;

    const extraParamsWithButtons = {
      ...baseExtraParams,
      ...Markup.keyboard(generatedButtons.map((b) => b.name)).resize(),
    };

    const shouldSendButtonsMessage = chat.chatParams?.responseButtonsMessage ?? true;
    if (shouldSendButtonsMessage) {
      const buttonsText = generatedButtons.map((b) => `- ${b.name}: ${b.prompt}`).join("\n");
      await sendTelegramMessage(msg.chat.id, buttonsText, extraParamsWithButtons, ctx, chat);
      return;
    }

    const updated = await editTelegramMessage(
      originalMessage,
      answerText,
      extraParamsWithButtons,
      ctx,
      chat,
    );

    if (updated?.chat.id) {
      useThreads()[updated.chat.id].msgs.push(updated);
    }
  } catch (error) {
    if (signal?.aborted) return;
    throw error;
  }
}
