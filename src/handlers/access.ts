import { Context } from "telegraf";
import { Chat, Message } from "telegraf/types";
import { ConfigChatType } from "../types.ts";
import { useConfig } from "../config.ts";
import { getCtxChatMsg } from "../telegram/context.ts";
import { isAdminUser, sendTelegramMessage } from "../telegram/send.ts";
import { log } from "../helpers.ts";

export default async function checkAccessLevel(
  ctx: Context,
): Promise<
  { msg: Message.TextMessage; chat: ConfigChatType } | false | undefined
> {
  const { msg, chat } = getCtxChatMsg(ctx);
  if (!msg) {
    console.log("no ctx message detected");
    return;
  }

  const chatTitle = (ctx.message?.chat as Chat.TitleChat)?.title || "";
  const chatId = msg.chat.id;
  const isPrivate = msg.chat.type === "private";

  if (!chat) {
    log({
      msg: `Not in whitelist, from: ${JSON.stringify(msg.from)}, text: ${msg.text}`,
      chatId,
      chatTitle,
      logLevel: "warn",
    });
    const text = isPrivate
      ? `You are not in whitelist. Your username: ${msg.from?.username}`
      : `This chat is not in whitelist.\nYour username: ${msg.from?.username}, chat id: ${msg.chat.id}`;
    const params = isAdminUser(msg)
      ? {
          reply_markup: {
            inline_keyboard: [[{ text: "Add", callback_data: "add_chat" }]],
          },
        }
      : undefined;
    await sendTelegramMessage(msg.chat.id, text, params, ctx);
    return;
  }

  if (!isMentioned(msg, chat)) {
    return false;
  }

  return { msg, chat };
}

export function isMentioned(
  msg: Message.TextMessage & { caption?: string },
  chat: ConfigChatType,
): boolean {
  const botName = chat.bot_name || useConfig().bot_name;
  const prefix = chat.prefix ?? "";
  const isPrivate = msg.chat.type === "private";
  const text =
    (msg as Message.TextMessage).text ||
    (msg as { caption?: string }).caption ||
    "";

  const replyAuthor = (msg.reply_to_message as Message.TextMessage)?.from
    ?.username;
  const isReply = Boolean(
    msg.reply_to_message && msg.from?.username !== replyAuthor,
  );
  const replyToBot = isReply && replyAuthor === botName;
  const replyToOther = isReply && replyAuthor !== botName;

  if (replyToOther) return false;
  if (!prefix) return true;

  if (replyToBot) return true;
  if (!isPrivate) {
    const hasPrefix = new RegExp(`^${prefix}`, "i").test(text);
    if (hasPrefix) return true;

    const hasMention = new RegExp(`@${botName}`, "i").test(text);
    if (hasMention) return true;

    return false;
  }

  return true;
}
