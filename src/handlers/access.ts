import { Context } from "telegraf";
import { Message } from "grammy/types";
import { ConfigChatType } from "../types.ts";
import { useConfig } from "../config.ts";
import { getCtxChatMsg } from "../telegram/context.ts";
import type { TitleChat } from "../telegram/updateTypes.ts";
import { isAdminUser, sendTelegramMessage } from "../telegram/send.ts";
import { log } from "../helpers.ts";

// Escape regex metacharacters so config-supplied prefix/bot_name values are
// matched literally and cannot break or alter the matching regex.
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default async function checkAccessLevel(
  ctx: Context,
): Promise<{ msg: Message.TextMessage; chat: ConfigChatType } | false | undefined> {
  const { msg, chat } = getCtxChatMsg(ctx);
  if (!msg) {
    console.log("no ctx message detected");
    return;
  }

  const chatTitle = (ctx.message?.chat as TitleChat)?.title || "";
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
    log({
      msg: `Not mentioned, from: ${JSON.stringify(msg.from)}, text: ${msg.text}`,
      chatId,
      chatTitle,
      logLevel: "debug",
    });
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
  const text = (msg as Message.TextMessage).text || (msg as { caption?: string }).caption || "";

  const replyAuthor = (msg.reply_to_message as Message.TextMessage)?.from?.username;
  const isReply = Boolean(msg.reply_to_message && msg.from?.username !== replyAuthor);
  const replyToBot = isReply && replyAuthor === botName;
  const replyToOther = isReply && replyAuthor !== botName;

  // Empty prefix keeps the original always-match behavior (regex `^`).
  const hasPrefix = new RegExp(`^${escapeRegExp(prefix)}`, "i").test(text);
  const hasTagged = new RegExp(`@${escapeRegExp(botName)}`, "i").test(text);
  const isMentioned = hasPrefix || hasTagged || replyToBot;
  if (prefix && !isMentioned) return false;
  if (replyToOther && !isMentioned) return false;
  return true;
}

// Reply context for history: whenever an incoming message replies to another
// (non-bot, non-self) user's message, that replied-to message should be added to
// LLM history for conversational continuity. Unlike isGuestModeReply this does
// NOT require guestMode.prompt — the caller (addToHistory) is only reached when
// the bot is already mentioned, so reply context is included regardless of guest
// mode (private and group chats alike).
export function shouldIncludeReplyInHistory(
  msg: Message.TextMessage & { caption?: string },
  chat: ConfigChatType,
): boolean {
  const reply = msg.reply_to_message as Message.TextMessage | undefined;
  if (!reply) return false;
  // Skip replies to the bot's own prior message — it is already in history.
  if (reply.from?.is_bot) return false;
  const botName = chat.bot_name || useConfig().bot_name;
  const replyAuthor = reply.from?.username;
  if (replyAuthor && botName && replyAuthor === botName) return false;
  // Skip replies to one's own message (no extra context to add).
  if (msg.from?.id && reply.from?.id && msg.from.id === reply.from.id) return false;
  if (msg.from?.username && replyAuthor && msg.from.username === replyAuthor) return false;
  return true;
}

// Guest mode: the bot is explicitly mentioned (tag/prefix) in a reply to another
// (non-bot) user. When global guest mode is enabled, such turns are processed and
// the replied-to message is added to history for conversational continuity.
export function isGuestModeReply(
  msg: Message.TextMessage & { caption?: string },
  chat: ConfigChatType,
): boolean {
  if (msg.chat.type === "private") return false;
  const reply = msg.reply_to_message as Message.TextMessage | undefined;
  if (!reply) return false;
  const guestMode = useConfig().guestMode;
  if (!guestMode?.prompt) return false;
  const botName = chat.bot_name || useConfig().bot_name;
  const replyAuthor = reply.from?.username;
  // Not a guest-mode reply when replying to the bot itself or to one's own message.
  if (!replyAuthor || replyAuthor === botName) return false;
  if (msg.from?.username === replyAuthor) return false;
  const text = msg.text || msg.caption || "";
  const prefix = chat.prefix ?? "";
  const hasPrefix = prefix ? new RegExp(`^${escapeRegExp(prefix)}`, "i").test(text) : false;
  const hasTagged = new RegExp(`@${escapeRegExp(botName)}`, "i").test(text);
  return hasPrefix || hasTagged;
}
