import { Message } from "telegraf/types";
import { useBot } from "../bot.ts";
import { useConfig } from "../config.ts";
import { ConfigChatButtonType, ConfigChatType } from "../types.ts";
import { Context, Markup } from "telegraf";
import { User } from "@telegraf/types/manage";
import {
  InlineKeyboardMarkup,
  ReplyKeyboardMarkup,
  ReplyKeyboardRemove,
  ForceReply,
} from "telegraf/typings/core/types/typegram";
import { log } from "../helpers.ts";
import telegramifyMarkdown from "telegramify-markdown";
import { splitBigMessage } from "../utils/text.ts";

interface TelegramError extends Error {
  response?: {
    error_code: number;
    description: string;
  };
}

export type ForwardOrigin = {
  type: "user" | "hidden_user";
  sender_user?: User;
  sender_user_name?: string;
};

// let lastResponse: Message.TextMessage | undefined
let forDelete: Message.TextMessage | undefined;

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

function telegramifyWithCodeBlocks(text: string): string {
  if (!text.includes("```")) {
    return telegramifyMarkdown(text, "escape");
  }
  return text
    .split(/(```[\s\S]*?```)/)
    .map((part) =>
      part.startsWith("```") ? part : telegramifyMarkdown(part, "escape"),
    )
    .join("");
}

export interface ExtraCtx {
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
  } else if (
    params.parse_mode === "MarkdownV2" ||
    params.parse_mode === "Markdown"
  ) {
    processedText = telegramifyWithCodeBlocks(text);
  }

  const msgs = splitBigMessage(processedText);

  for (const [index, msg] of msgs.entries()) {
    if (index > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    try {
      response = await useBot(chatConfig.bot_token).telegram.sendMessage(
        chat_id,
        msg,
        params,
      );
    } catch (e: unknown) {
      const error = e as TelegramError;
      // Fallback: if error is 'bot was blocked by the user', handle gracefully
      log({
        msg: `Error sending message to user ${chat_id}: ${error.response?.description || "Unknown error"}, msg: ${msg}`,
        chatId: chat_id,
        chatTitle: chatConfig.name,
        logLevel: "warn",
      });
      if (error?.response?.error_code === 403) {
        // Telegram error 403: bot was blocked by the user
        log({
          msg: `User ${chat_id} blocked the bot. Error: ${error.response?.description || "Unknown error"}`,
          chatId: chat_id,
          logLevel: "warn",
        });
        continue;
      }
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
          response!.chat.id,
          response!.message_id,
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

  return response;
}

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

export function isOurUser(
  sender_user: User | undefined,
  chatConfig: ConfigChatType,
) {
  const username = sender_user?.username;
  const chatPrivateUsers = chatConfig?.privateUsers || [];
  const isOurUser =
    username &&
    [chatPrivateUsers, useConfig().privateUsers, useConfig().adminUsers]
      .flat()
      .includes(username);
  return isOurUser;
}

export function getTelegramForwardedUser(
  msg: Message.TextMessage & { forward_origin?: ForwardOrigin },
  chatConfig: ConfigChatType,
) {
  const forwardOrigin = msg.forward_origin;
  if (!forwardOrigin) return "";

  const username = forwardOrigin?.sender_user?.username;
  const isOur = isOurUser(forwardOrigin.sender_user, chatConfig);
  if (isOur) return "";

  const name =
    forwardOrigin.type === "hidden_user"
      ? forwardOrigin.sender_user_name
      : `${forwardOrigin.sender_user?.first_name ?? ""} ${
          forwardOrigin.sender_user?.last_name ?? ""
        }`.trim();

  return `${name}${username ? `, Telegram: @${username}` : ""}`;
}
