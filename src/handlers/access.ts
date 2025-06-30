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

// answer always in private chat
// in public chats answer when:
// - tagged by prefix
// - tagged by botName
// - reply to bot
// - no prefix and no reply message
export function isMentioned(
  msg: Message.TextMessage & { caption?: string },
  chat: ConfigChatType,
): boolean {
  const botName = chat.bot_name || useConfig().bot_name;
  const prefix = chat.prefix ?? "";
  const isPrivate = msg.chat.type === "private";
  if (isPrivate) return true;
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

  const hasPrefix = new RegExp(`^${prefix}`, "i").test(text);
  const hasTagged = new RegExp(`@${botName}`, "i").test(text);
  const isMentioned = hasPrefix || hasTagged || replyToBot;
  if (prefix && !isMentioned) return false;
  if (replyToOther) return false;
  return true;
}
