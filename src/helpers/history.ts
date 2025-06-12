import { Message } from "telegraf/types";
import { CompletionParamsType, ConfigChatType } from "../types.ts";
import { getFullName } from "./telegram.ts";
import OpenAI from "openai";
import { useThreads } from "../threads.ts";

export function addToHistory({
  msg,
  answer,
  completionParams,
  showTelegramNames,
}: {
  msg: Message.TextMessage;
  answer?: string;
  completionParams?: CompletionParamsType;
  showTelegramNames?: boolean;
}) {
  const key = msg.chat?.id || 0;
  const threads = useThreads();
  if (!threads[key]) {
    threads[key] = {
      id: key,
      msgs: [],
      messages: [],
      completionParams,
    };
  }
  let messageItem: OpenAI.ChatCompletionMessageParam;
  if (answer) {
    messageItem = {
      role: "system",
      content: answer,
    };
  } else {
    let content = msg.text || "";
    if (showTelegramNames) {
      const name = getFullName(msg);
      if (name) {
        content = `${name}:\n${content}`;
      }
    }
    messageItem = {
      role: "user",
      content,
      name: msg.from?.first_name,
    };
  }
  threads[key].messages.push(messageItem);

  if (!answer) {
    threads[key].msgs.push(msg);
    // limit history from begin to last 20 messages
    threads[key].msgs = threads[key].msgs.slice(-20);
  }
}

export function forgetHistory(chatId: number) {
  const threads = useThreads();
  if (threads[chatId]) {
    threads[chatId].messages = [];
  }
}

export function forgetHistoryOnTimeout(
  chat: ConfigChatType,
  msg: Message.TextMessage,
) {
  const threads = useThreads();
  const thread = threads[msg.chat.id];
  const forgetTimeout = chat.chatParams?.forgetTimeout;
  if (forgetTimeout && thread && thread.msgs.length > 1) {
    const lastMessageTime = new Date(
      thread.msgs[thread.msgs.length - 2].date * 1000,
    ).getTime();
    const currentTime = Date.now();
    const timeDelta = (currentTime - lastMessageTime) / 1000;
    if (timeDelta > forgetTimeout) {
      forgetHistory(msg.chat.id);
      addToHistory({
        msg,
        completionParams: chat.completionParams,
        showTelegramNames: chat.chatParams?.showTelegramNames,
      });
      return true;
    }
  }
  return false;
}
