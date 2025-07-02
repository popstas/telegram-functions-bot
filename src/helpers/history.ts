import { Message } from "telegraf/types";
import { ConfigChatType } from "../types.ts";
import { isOurUser } from "../telegram/send.ts";
import OpenAI from "openai";
import { useThreads } from "../threads.ts";

export function initThread(
  msg: Message.TextMessage,
  chatConfig: ConfigChatType,
) {
  const threads = useThreads();
  const key = msg.chat?.id || 0;
  if (!threads[key]) {
    threads[key] = {
      id: key,
      msgs: [],
      messages: [],
      completionParams: chatConfig.completionParams,
    };
  }
  return threads[key];
}

export function buildUserMessage(
  msg: Message.TextMessage,
  chatConfig: ConfigChatType,
): OpenAI.ChatCompletionMessageParam {
  const content = msg.text || "";
  const sender = msg.forward_from || msg.from;
  const isOur = isOurUser(sender, chatConfig);
  let name = sender?.first_name || sender?.last_name || sender?.username;
  if (isOur && chatConfig?.chatParams?.markOurUsers) {
    name = `${name} (${chatConfig.chatParams.markOurUsers})`;
  }
  return {
    role: "user",
    content,
    name,
  } as OpenAI.ChatCompletionMessageParam;
}

export function addToHistory(
  msg: Message.TextMessage,
  chatConfig: ConfigChatType,
  answer?: string,
) {
  const threads = useThreads();
  const key = msg.chat?.id || 0;
  initThread(msg, chatConfig);
  if (answer) {
    threads[key].messages.push({ role: "system", content: answer });
  } else {
    const messageItem = buildUserMessage(msg, chatConfig);
    threads[key].messages.push(messageItem);
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
      addToHistory(msg, chat);
      return true;
    }
  }
  return false;
}
