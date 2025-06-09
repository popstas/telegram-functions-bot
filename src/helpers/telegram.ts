import { Chat, Message, Update } from "telegraf/types";
import { useBot } from "../bot.ts";
import { useConfig } from "../config.ts";
import {
  CompletionParamsType,
  ConfigChatButtonType,
  ConfigChatType,
} from "../types.ts";
import { Context, Markup } from "telegraf";
import { User } from "@telegraf/types/manage";
import {
  InlineKeyboardMarkup,
  ReplyKeyboardMarkup,
  ReplyKeyboardRemove,
  ForceReply,
} from "telegraf/typings/core/types/typegram";
import { log } from "../helpers.ts";

interface TelegramError extends Error {
  response?: {
    error_code: number;
    description: string;
  };
}
type ForwardOrigin = {
  type: "user" | "hidden_user";
  sender_user?: User;
  sender_user_name?: string;
};
import telegramifyMarkdown from "telegramify-markdown";

// let lastResponse: Message.TextMessage | undefined
let forDelete: Message.TextMessage | undefined;

export function splitBigMessage(text: string) {
  const msgs: string[] = [];
  const sizeLimit = 4096;
  let msg = "";

  for (const origLine of text.split("\n")) {
    const line = origLine.trim();
    if (!line) continue; // skip empty or whitespace-only lines
    if (msg.length + line.length + 1 > sizeLimit) {
      // +1 for the added '\n'
      if (msg.trim()) msgs.push(msg);
      msg = "";
    }
    msg += line + "\n";
  }
  if (msg.length > sizeLimit) {
    msg = msg.slice(0, sizeLimit - 3) + "...";
  }
  if (msg.trim()) msgs.push(msg);
  return msgs;
}

function sanitizeTelegramHtml(html: string): string {
  // Заменяем <p> и </p> на двойной перенос строки
  let result = html.replace(/<p[^>]*>/gi, "").replace(/<\/p>/gi, "\n\n");
  // Удаляем <span> и </span>
  result = result.replace(/<span[^>]*>/gi, "").replace(/<\/span>/gi, "");
  // Все варианты <br>, <br/>, <br /> заменяем на \n
  result = result.replace(/<br\s*\/?>/gi, "\n");
  // Telegram не поддерживает &nbsp; — заменяем на пробел
  result = result.replace(/&nbsp;/gi, " ");
  // Удаляем лишние пустые строки
  result = result.replace(/\n{3,}/g, "\n\n");
  return result.trim();
}

interface ExtraCtx {
  noSendTelegram?: boolean;
  progressCallback?: (msg: string) => void;
}

export async function sendTelegramMessage(
  chat_id: number,
  text: string,
  extraMessageParams?:
    | Record<string, unknown>
    | Markup.Markup<ReplyKeyboardMarkup>,
  ctx?: Context & ExtraCtx,
  chatConfig?: ConfigChatType,
): Promise<Message.TextMessage | undefined> {
  chatConfig =
    chatConfig ||
    useConfig().chats.find((c) => c.bot_name === ctx?.botInfo.username) ||
    ({} as ConfigChatType);

  if (ctx?.noSendTelegram) {
    ctx.progressCallback?.(text);
    return undefined;
  }

  let response: Message.TextMessage | undefined;
  const params: Record<string, unknown> = {
    ...extraMessageParams,
    // disable_web_page_preview: true,
    // disable_notification: true,
    // parse_mode: 'HTML'
  };

  // strip <final_answer> tags, preserve content
  text = text.replace(/<final_answer>(.*?)<\/final_answer>/ms, "$1");

  // Если начинается на <think>, то выделять текст внутри <think></think> и отправлять отдельным сообщением
  if (text.trim().startsWith("<think>")) {
    let thinkBody = text.trim();
    thinkBody = thinkBody.slice("<think>".length);
    thinkBody = thinkBody.replace(/<\/think>.*/ms, "");
    const thinkText = "`think:`\n" + thinkBody.trim();
    text = text.replace(/<think>.*?<\/think>/ms, "").trim();
    if (!params.parse_mode) {
      if (text.trim().startsWith("<") && !text.trim().startsWith("<think>")) {
        params.parse_mode = "HTML";
      } else {
        params.parse_mode = "MarkdownV2";
      }
    }
    await sendTelegramMessage(chat_id, thinkText, params, ctx, chatConfig);
  }

  // Автоматически определить режим разметки, если не задан явно
  if (!params.parse_mode) {
    if (text.trim().startsWith("<") && !text.trim().startsWith("<think>")) {
      params.parse_mode = "HTML";
    } else {
      params.parse_mode = "MarkdownV2";
    }
  }

  let processedText = text;

  // Process the text based on parse_mode
  if (params.parse_mode === "HTML") {
    processedText = sanitizeTelegramHtml(text);
  } else if (params.parse_mode === "MarkdownV2") {
    // const replacedNewlines = text.replace(/\n/g, '#n');
    // const ZWSP = '\u200B';
    processedText = telegramifyMarkdown(processedText, "keep");
    // processedText = processedText.replace(/\\#n/g, `\n${ZWSP}`);
  } else if (params.parse_mode === "Markdown") {
    processedText = telegramifyMarkdown(text, "keep");
  }

  const msgs = splitBigMessage(processedText);

  for (const msg of msgs) {
    try {
      response = await useBot(chatConfig.bot_token).telegram.sendMessage(
        chat_id,
        msg,
        params,
      );
    } catch (e: unknown) {
      const error = e as TelegramError;
      // Fallback: if error is 'bot was blocked by the user', handle gracefully
      if (error?.response?.error_code === 403) {
        // Telegram error 403: bot was blocked by the user
        log({
          msg: `User ${chat_id} blocked the bot. Error: ${error.response?.description || "Unknown error"}`,
          chatId: chat_id,
          logLevel: "warn",
        });
        // Optionally: flag user in DB or take other action
        continue;
      }
      // Fallback to failsafeParams for other errors
      // Previous fallback code:
      // const failsafeParams = { reply_markup: params.reply_markup };
      // response = await useBot(chatConfig.bot_token).telegram.sendMessage(chat_id, msg, failsafeParams);
      const failsafeParams = {
        reply_markup: params.reply_markup as
          | InlineKeyboardMarkup
          | ReplyKeyboardMarkup
          | ReplyKeyboardRemove
          | ForceReply
          | undefined,
      };
      response = await useBot(chatConfig.bot_token).telegram.sendMessage(
        chat_id,
        msg,
        failsafeParams,
      );
    }
  }

  // deleteAfter timeout
  if (params.deleteAfter) {
    const deleteAfter =
      typeof params.deleteAfter === "number"
        ? params.deleteAfter * 1000
        : 10000;
    if (response)
      setTimeout(async () => {
        await useBot(chatConfig?.bot_token).telegram.deleteMessage(
          response.chat.id,
          response.message_id,
        );
      }, deleteAfter);
  }

  if (forDelete) {
    await useBot(chatConfig.bot_token).telegram.deleteMessage(
      forDelete.chat.id,
      forDelete.message_id,
    );
    forDelete = undefined;
  }

  // deleteAfterNext message
  if (params.deleteAfterNext) {
    forDelete = response;
  }

  // lastResponse = response
  return response;
}

// Check if the user is an admin
export function isAdminUser(msg: Message.TextMessage): boolean {
  if (!msg.from?.username) return false;
  return (useConfig().adminUsers || []).includes(msg.from.username);
}

export function buildButtonRows(buttons: ConfigChatButtonType[]) {
  const buttonRows: { text: string }[][] = [[]];
  buttons.forEach((b) => {
    b.row = b.row || 1;
    const index = b.row - 1;
    buttonRows[index] = buttonRows[index] || [];
    buttonRows[index].push({ text: b.name });
  });
  return buttonRows;
}

export function getFullName(msg: {
  from?: User;
  forward_origin?: ForwardOrigin;
}) {
  const forwardOrigin = msg.forward_origin;
  if (forwardOrigin) {
    if (forwardOrigin.type === "hidden_user") {
      return forwardOrigin.sender_user_name || "";
    }
    const user = forwardOrigin.sender_user;
    if (user) {
      return [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
    }
  }
  if (msg.from) {
    return [msg.from.first_name, msg.from.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();
  }
}

function isAccessAllowed(chatConfig: ConfigChatType, ctxChat: Chat) {
  const privateChat = ctxChat as Chat.PrivateChat;
  const allowedUsers = [
    ...(chatConfig.privateUsers ?? useConfig().privateUsers),
    ...(useConfig().adminUsers ?? []),
  ];
  const username = privateChat.username || "without_username";
  return allowedUsers.includes(username);
}

function getChatConfig(
  ctxChat: Chat,
  ctx: Context,
): ConfigChatType | undefined {
  // 1. by chat id
  let chat =
    useConfig().chats.find(
      (c) => c.id == ctxChat?.id || c.ids?.includes(ctxChat?.id) || 0,
    ) || ({} as ConfigChatType);

  const defaultChat = useConfig().chats.find((c) => c.name === "default");

  // 2. by bot_name
  if (!chat.id) {
    chat =
      useConfig().chats.find((c) => c.bot_name === ctx.botInfo.username) ||
      ({} as ConfigChatType);

    // check access to private chat
    if (chat.id && ctxChat?.type === "private") {
      if (!isAccessAllowed(chat, ctxChat)) {
        return;
      }
    }
  }

  if (!chat.id) {
    // console.log("ctxChat:", ctxChat);
    if (ctxChat?.type !== "private") {
      const chatTitle = (ctxChat as Chat.TitleChat).title;
      log({
        msg: `This is ${ctxChat?.type} chat, not in whitelist: ${ctxChat.title}`,
        chatId: ctxChat.id,
        chatTitle,
        logLevel: "warn",
      });
      return;
    }

    if (defaultChat) chat = defaultChat;

    // 2. by username
    if (ctxChat?.type === "private") {
      // user chat, with username
      const privateChat = ctxChat as Chat.PrivateChat;

      // check access
      if (!isAccessAllowed(chat, ctxChat)) {
        return;
      }

      const userChat = useConfig().chats.find(
        (c) => c.username === privateChat.username || "",
      );
      if (userChat) chat = userChat;
    }
  }

  function mergeConfigParam<T extends Record<string, unknown>>(
    name: keyof T,
    from: Partial<T> | undefined,
    to: T | undefined,
  ) {
    if (!from || !from[name] || !to) return;
    to[name] = to[name]
      ? ({
          ...(from[name] as object),
          ...(to[name] as object),
        } as T[typeof name])
      : from[name];
  }

  mergeConfigParam<{ completionParams: CompletionParamsType }>(
    "completionParams",
    useConfig() as Partial<{ completionParams: CompletionParamsType }>,
    chat,
  );

  if (chat && defaultChat) {
    chat = { ...defaultChat, ...chat };
    mergeConfigParam<{ completionParams: CompletionParamsType }>(
      "completionParams",
      defaultChat,
      chat,
    );
  }

  return chat;
}

export function getActionUserMsg(ctx: Context): { user?: User; msg?: Message } {
  // edited message
  if (Object.prototype.hasOwnProperty.call(ctx, "update")) {
    const updateQuery = ctx.update as Update.CallbackQueryUpdate;
    const user = updateQuery.callback_query.from;
    const msg = updateQuery.callback_query.message;
    return { user, msg };
  }
  return {};
}

// return {chat, msg}
export function getCtxChatMsg(ctx: Context): {
  chat: ConfigChatType | undefined;
  msg: Message.TextMessage | undefined;
} {
  let ctxChat: Chat | undefined;
  let msg: Message.TextMessage | undefined;

  // edited message
  if (Object.prototype.hasOwnProperty.call(ctx, "update")) {
    // console.log("ctx.update:", ctx.update);
    const updateEdited = ctx.update as Update.EditedMessageUpdate; //{ edited_message: Message.TextMessage, chat: Chat };
    const updateNew = ctx.update as Update.MessageUpdate;
    msg = (updateEdited.edited_message ||
      updateNew.message) as Message.TextMessage;
    // console.log("msg:", msg);
    ctxChat = msg?.chat;
    // console.log('no message in ctx');
    // return;
  }

  if (!ctxChat) {
    console.log("no ctx chat detected");
    return { chat: undefined, msg: undefined };
  }

  const chat = getChatConfig(ctxChat, ctx);

  return { chat, msg };
}

export function getTelegramForwardedUser(
  msg: Message.TextMessage & { forward_origin?: ForwardOrigin },
  chatConfig: ConfigChatType,
) {
  const forwardOrigin = msg.forward_origin;
  if (!forwardOrigin) return "";

  const username = forwardOrigin?.sender_user?.username;
  const isOurUser =
    username &&
    [chatConfig.privateUsers, useConfig().privateUsers]
      .flat()
      .includes(username);
  if (isOurUser) return "";

  const name =
    forwardOrigin.type === "hidden_user"
      ? forwardOrigin.sender_user_name
      : `${forwardOrigin.sender_user?.first_name ?? ""} ${forwardOrigin.sender_user?.last_name ?? ""}`.trim();

  return `${name}${username ? `, Telegram: @${username}` : ""}`;
}
