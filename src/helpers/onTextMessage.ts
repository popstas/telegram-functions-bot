import { Context, Markup } from "telegraf";
import { Chat, Message } from "telegraf/types";
import { useThreads } from "../threads.ts";
import { ConfigChatType } from "../types.ts";
import { syncButtons, useConfig } from "../config.ts";
import { log } from "../helpers.ts";
import { addToHistory, forgetHistory } from "./history.ts";
import { setLastCtx } from "./lastCtx.ts";
import { addOauthToThread, ensureAuth } from "./google.ts";
import { getChatgptAnswer } from "./gpt.ts";
import checkAccessLevel from "./checkAccessLevel.ts";
import resolveChatButtons from "./resolveChatButtons.ts";
import { sendTelegramMessage } from "./telegram.ts";

export default async function onTextMessage(
  ctx: Context & { secondTry?: boolean },
  next?: () => Promise<void> | void,
  callback?: (msg: Message.TextMessage) => Promise<void> | void,
) {
  const threads = useThreads();
  setLastCtx(ctx);

  const access = await checkAccessLevel(ctx);
  if (!access) return;
  const { msg, chat } = access;

  const botName = chat?.bot_name || useConfig().bot_name;
  let mentioned = false;

  if (
    msg.reply_to_message &&
    msg.from?.username !== msg.reply_to_message.from?.username
  ) {
    if (msg.reply_to_message.from?.username !== botName) return;
    mentioned = true;
  }

  const chatTitle = (ctx.message?.chat as Chat.TitleChat).title || "";
  const chatId = msg.chat.id;
  const isPrivate = msg.chat.type === "private";

  if (chat.prefix && !mentioned && !isPrivate) {
    const re = new RegExp(`^${chat.prefix}`, "i");
    const isBot = re.test(msg.text);
    if (!isBot) {
      const mention = new RegExp(`@${botName}`, "i");
      mentioned = mention.test(msg.text);
      if (!mentioned) {
        log({
          msg: `Not mentioned, text: ${msg.text}`,
          logLevel: "debug",
          chatId,
          chatTitle,
          role: "user",
          username: msg?.from?.username,
        });
        return;
      }
    }
  }

  log({
    msg: msg.text,
    logLevel: "info",
    chatId,
    chatTitle,
    role: "user",
    username: msg?.from?.username,
  });

  addToHistory({
    msg,
    completionParams: chat.completionParams,
    showTelegramNames: chat.chatParams?.showTelegramNames,
  });
  const thread = threads[msg.chat.id];

  const forgetTimeout = chat.chatParams?.forgetTimeout;
  if (forgetTimeout && thread.msgs.length > 1) {
    const lastMessageTime = new Date(
      thread.msgs[thread.msgs.length - 2].date * 1000,
    ).getTime();
    const currentTime = new Date().getTime();
    const timeDelta = (currentTime - lastMessageTime) / 1000;
    if (timeDelta > forgetTimeout) {
      forgetHistory(msg.chat.id);
      addToHistory({
        msg,
        completionParams: chat.completionParams,
        showTelegramNames: chat.chatParams?.showTelegramNames,
      });
    }
  }

  const extraMessageParams = ctx.message?.message_id
    ? { reply_to_message_id: ctx.message?.message_id }
    : {};

  const buttonResponse = await resolveChatButtons(
    ctx,
    msg,
    chat,
    thread,
    extraMessageParams,
  );
  if (buttonResponse) return buttonResponse;

  const historyLength = thread.messages.length;
  await ctx.persistentChatAction("typing", async () => {});
  setTimeout(async () => {
    if (thread.messages.length !== historyLength) return;
    const msgSent = await answerToMessage(ctx, msg, chat, extraMessageParams);
    if (msgSent && typeof callback === "function") {
      await callback(msgSent);
    }
  }, 5000);
}

async function answerToMessage(
  ctx: Context & { secondTry?: boolean },
  msg: Message.TextMessage,
  chat: ConfigChatType,
  extraMessageParams: Record<string, unknown>,
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

        const extraParams = Markup.keyboard(
          buttons.map((b) => b.name),
        ).resize();
        const answer = `Готово: ${buttons.map((b) => b.name).join(", ")}`;
        syncResult = await sendTelegramMessage(
          msg.chat.id,
          answer,
          extraParams,
          ctx,
          chat,
        );
      });
      return syncResult;
    }
  }

  try {
    let msgSent: Message.TextMessage | undefined;
    await ctx.persistentChatAction("typing", async () => {
      if (!msg) return;
      const res = await getChatgptAnswer(msg, chat, ctx);
      const text = res?.content || "бот не ответил";
      const extraParams: Record<string, unknown> = {
        ...extraMessageParams,
      };
      const buttons = chat.buttonsSynced || chat.buttons;
      if (buttons) {
        const extraParamsButtons = Markup.keyboard(
          buttons.map((b) => b.name),
        ).resize();
        Object.assign(extraParams, extraParamsButtons);
      }
      const chatTitle = (msg.chat as Chat.TitleChat).title;
      log({
        msg: text,
        logLevel: "info",
        chatId: msg.chat.id,
        chatTitle,
        role: "system",
      });
      msgSent = await sendTelegramMessage(
        msg.chat.id,
        text,
        extraParams,
        ctx,
        chat,
      );
      if (msgSent?.chat.id) useThreads()[msgSent.chat.id].msgs.push(msgSent);
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
