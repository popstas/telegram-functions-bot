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
  let mentioned = false;
  const isPrivate = msg.chat.type === "private";
  const text =
    (msg as Message.TextMessage).text ||
    (msg as { caption?: string }).caption ||
    "";

  if (
    msg.reply_to_message &&
    msg.from?.username !==
      (msg.reply_to_message as Message.TextMessage).from?.username
  ) {
    if (
      (msg.reply_to_message as Message.TextMessage).from?.username !== botName
    )
      return false;
    mentioned = true;
  }

  if (chat.prefix && !mentioned && !isPrivate) {
    const re = new RegExp(`^${chat.prefix}`, "i");
    const isBot = re.test(text);
    if (!isBot) {
      const mention = new RegExp(`@${botName}`, "i");
      mentioned = mention.test(text);
      if (!mentioned) return false;
    }
  }

  return true;
}
