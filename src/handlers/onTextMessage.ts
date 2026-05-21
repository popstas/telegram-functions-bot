import { Context, Markup } from "telegraf";
import { Chat, Message } from "telegraf/types";
import { useThreads } from "../threads.ts";
import { ConfigChatType, ThreadStateType } from "../types.ts";
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
import checkAccessLevel, { isGuestModeReply } from "./access.ts";
import resolveChatButtons from "./resolveChatButtons.ts";
import { handleFormFlow } from "./formFlow.ts";
import { editTelegramMessage, sendTelegramMessage } from "../telegram/send.ts";

// Track active responses per chat to allow cancellation
interface ActiveResponse {
  abortController: AbortController;
  buttonsAbortController?: AbortController;
  isCompleted: boolean;
}

const activeResponses = new Map<number, ActiveResponse>();

// Secretary mode: per-chat debounce state. While a timer is pending, incoming
// messages are added to history without triggering an answer; on expiry the
// bot answers once using the latest message context.
interface SecretaryState {
  timer: ReturnType<typeof setTimeout>;
  ctx: Context & { secondTry?: boolean };
  msg: Message.TextMessage;
  chat: ConfigChatType;
  callback?: (msg: Message.TextMessage) => Promise<void> | void;
}

const secretaryTimers = new Map<number, SecretaryState>();

// Per-chat last-activity timestamp (epoch ms). A secretary "session" stays alive
// while messages keep arriving; the firstAnswerDelay debounce applies only to the
// first message of a session (i.e. after sessionDurationSeconds of inactivity).
const DEFAULT_SESSION_DURATION_SECONDS = 600;
const secretarySessions = new Map<number, number>();

// Exposed for tests to reset module-level state between runs.
export const __testSecretary = {
  clear() {
    for (const state of secretaryTimers.values()) clearTimeout(state.timer);
    secretaryTimers.clear();
    secretarySessions.clear();
  },
  has(chatId: number) {
    return secretaryTimers.has(chatId);
  },
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Guest mode: when the bot is mentioned in a reply to another user, apply the
// configured guest prompt as the per-turn system instruction. Applied at the
// point the answer is launched (not on batched secretary turns) so the override
// always matches the message actually being answered.
function applyGuestModeOverride(
  thread: ThreadStateType,
  msg: Message.TextMessage,
  chat: ConfigChatType,
) {
  const guestPrompt = useConfig().guestMode?.prompt;
  if (guestPrompt && isGuestModeReply(msg, chat)) {
    thread.nextSystemMessage = guestPrompt;
  }
}

// Resolve the per-turn system override for a secretary answer: the secretary prompt
// takes precedence; otherwise fall back to the guest-mode override evaluated against
// the message actually being answered. Used by both the debounced (session start) and
// the immediate (in-session) secretary paths.
function applySecretaryTurnOverride(
  thread: ThreadStateType,
  msg: Message.TextMessage,
  chat: ConfigChatType,
) {
  const secretaryPrompt = chat.chatParams?.secretary?.prompt;
  if (secretaryPrompt) {
    thread.nextSystemMessage = secretaryPrompt;
  } else {
    applyGuestModeOverride(thread, msg, chat);
  }
}

// Cancel any in-flight answer for the chat, then start a new one. Bookkeeping
// for cancellation lives in `activeResponses`.
function launchAnswer(
  ctx: Context & { secondTry?: boolean },
  msg: Message.TextMessage,
  chat: ConfigChatType,
  callback?: (msg: Message.TextMessage) => Promise<void> | void,
) {
  const chatId = msg.chat.id;
  const answerId = msg.message_id?.toString() || "";
  const businessConnectionId = (ctx as { businessConnectionId?: string }).businessConnectionId;
  const extraMessageParams = {
    ...(ctx.message?.message_id ? { reply_to_message_id: ctx.message?.message_id } : {}),
    ...(businessConnectionId ? { business_connection_id: businessConnectionId } : {}),
  };

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
      // Ignore errors from aborted requests (superseded responses abort on purpose).
      if (!abortController.signal.aborted) {
        log({
          msg: `response handler error: ${error instanceof Error ? error.message : String(error)}`,
          logLevel: "error",
          chatId,
          answerId,
          chatTitle: (msg.chat as Chat.TitleChat).title,
          role: "system",
          username: msg?.from?.username,
        });
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

  // Handle form flow if configured
  const formResult = await handleFormFlow(ctx, msg, chat, thread, extraMessageParams);
  if (formResult !== undefined) return formResult;

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

  // Secretary mode: debounce answers per chat. The first message starts a
  // timer; messages arriving within the window are added to history above but
  // do not trigger an answer. On expiry the bot answers once using the latest
  // message context.
  // On the context_length_exceeded retry (secondTry), the answer should fire
  // immediately rather than wait another debounce window.
  // When a callback is supplied (HTTP interface), bypass debounce entirely:
  // the callback ends the HTTP response, so deferring it into the timer would
  // hang the request for the delay window and orphan superseded responses.
  const secretary = chat.chatParams?.secretary;
  if (secretary && secretary.firstAnswerDelay > 0 && !ctx.secondTry && !callback) {
    const existing = secretaryTimers.get(chatId);
    if (existing) {
      // Already waiting — update to the latest message and keep batching.
      existing.ctx = ctx;
      existing.msg = msg;
      existing.chat = chat;
      existing.callback = callback;
      log({
        msg: "secretary: batched message into pending answer",
        logLevel: "debug",
        chatId,
        answerId,
        chatTitle,
        role: "system",
        username: msg?.from?.username,
      });
      return;
    }

    // The firstAnswerDelay debounce applies only to the first message of a session.
    // A session stays alive while messages keep arriving; it expires after
    // sessionDurationSeconds of inactivity (sliding window).
    const sessionMs = (secretary.sessionDurationSeconds ?? DEFAULT_SESSION_DURATION_SECONDS) * 1000;
    const last = secretarySessions.get(chatId);
    const sessionActive = last !== undefined && Date.now() - last <= sessionMs;

    if (sessionActive) {
      // Mid-session: answer immediately and slide the session window forward.
      secretarySessions.set(chatId, Date.now());
      applySecretaryTurnOverride(thread, msg, chat);
      log({
        msg: "secretary: session active, answering immediately",
        logLevel: "debug",
        chatId,
        answerId,
        chatTitle,
        role: "system",
        username: msg?.from?.username,
      });
      launchAnswer(ctx, msg, chat, callback);
      return;
    }

    const state: SecretaryState = { timer: undefined as never, ctx, msg, chat, callback };
    state.timer = setTimeout(() => {
      secretaryTimers.delete(chatId);
      try {
        // The session becomes active once the opening answer fires.
        secretarySessions.set(chatId, Date.now());
        log({
          msg: "secretary: delay elapsed, answering",
          logLevel: "info",
          chatId,
          chatTitle,
          role: "system",
        });
        // Resolve the per-turn system override from the final batched message, so a
        // guest prompt that applied to an earlier batched turn cannot leak into a
        // non-guest answer.
        applySecretaryTurnOverride(thread, state.msg, state.chat);
        launchAnswer(state.ctx, state.msg, state.chat, state.callback);
      } catch (e) {
        // A synchronous throw here would otherwise be an unhandled exception:
        // no log, no answer. Record it so the failing step is visible.
        log({
          msg: `secretary timer error: ${(e as Error).message}`,
          logLevel: "error",
          chatId,
          chatTitle,
          role: "system",
        });
      }
    }, secretary.firstAnswerDelay * 1000);
    secretaryTimers.set(chatId, state);
    log({
      msg: `secretary: waiting ${secretary.firstAnswerDelay}s before answering`,
      logLevel: "info",
      chatId,
      answerId,
      chatTitle,
      role: "system",
      username: msg?.from?.username,
    });
    return;
  }

  // Non-debounced path (no secretary, HTTP callback, or secondTry retry):
  // apply the guest-mode override for this exact message before answering.
  applyGuestModeOverride(thread, msg, chat);
  launchAnswer(ctx, msg, chat, callback);
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
