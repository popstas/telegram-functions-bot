import { Chat, Message, Update } from "telegraf/types";
import { Context } from "telegraf";
import { User } from "@telegraf/types/manage";
import { useConfig } from "../config.ts";
import { log } from "../helpers.ts";
import { includesUser } from "../utils/users.ts";
import {
  ChatParamsType,
  CompletionParamsType,
  ConfigChatType,
} from "../types.ts";

function isAccessAllowed(chatConfig: ConfigChatType, ctxChat: Chat) {
  const privateChat = ctxChat as Chat.PrivateChat;
  const allowedUsers = [
    ...(chatConfig.privateUsers ?? useConfig().privateUsers),
    ...(useConfig().adminUsers ?? []),
  ];
  const username = privateChat.username || "without_username";
  return includesUser(allowedUsers, username);
}

function getChatConfig(
  ctxChat: Chat,
  ctx: Context,
): ConfigChatType | undefined {
  let chat =
    useConfig().chats.find(
      (c) => c.id == ctxChat?.id || c.ids?.includes(ctxChat?.id) || 0,
    ) || ({} as ConfigChatType);

  const defaultChat = useConfig().chats.find((c) => c.name === "default");

  if (!chat.id) {
    chat =
      useConfig().chats.find((c) => c.bot_name === ctx.botInfo.username) ||
      ({} as ConfigChatType);

    if (chat.id && ctxChat?.type === "private") {
      if (!isAccessAllowed(chat, ctxChat)) {
        return;
      }
    }
  }

  if (!chat.id) {
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

    if (ctxChat?.type === "private") {
      const privateChat = ctxChat as Chat.PrivateChat;

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
    mergeConfigParam<{ chatParams: ChatParamsType }>(
      "chatParams",
      defaultChat,
      chat,
    );
  }

  return chat;
}

export function getActionUserMsg(ctx: Context): { user?: User; msg?: Message } {
  if (Object.prototype.hasOwnProperty.call(ctx, "update")) {
    const updateQuery = ctx.update as Update.CallbackQueryUpdate;
    const user = updateQuery.callback_query.from;
    const msg = updateQuery.callback_query.message as Message;
    return { user, msg };
  }
  return {};
}

export function getCtxChatMsg(ctx: Context): {
  chat: ConfigChatType | undefined;
  msg: Message.TextMessage | undefined;
} {
  let ctxChat: Chat | undefined;
  let msg: Message.TextMessage | undefined;

  if (Object.prototype.hasOwnProperty.call(ctx, "update")) {
    const updateEdited = ctx.update as Update.EditedMessageUpdate;
    const updateNew = ctx.update as Update.MessageUpdate;
    msg = (updateEdited.edited_message ||
      updateNew.message) as Message.TextMessage;
    ctxChat = msg?.chat;
  }

  if (!ctxChat) {
    console.log("no ctx chat detected");
    return { chat: undefined, msg: undefined };
  }

  const chat = getChatConfig(ctxChat, ctx);

  return { chat, msg };
}
