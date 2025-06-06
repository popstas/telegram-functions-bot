import {Message} from "telegraf/types";
import {CompletionParamsType} from "../types.ts";
import OpenAI from "openai";
import {useThreads} from "../threads.ts";

export function addToHistory({msg, answer, completionParams}: {
  msg: Message.TextMessage;
  answer?: string,
  completionParams?: CompletionParamsType;
}) {
  const key = msg.chat?.id || 0
  const threads = useThreads();
  if (!threads[key]) {
    threads[key] = {
      id: key,
      msgs: [],
      messages: [],
      completionParams,
    }
  }
  let messageItem: OpenAI.ChatCompletionMessageParam;
  if (answer) {
    messageItem = {
      role: 'system',
      content: answer
    };
  } else {
    messageItem = {
      role: 'user',
      content: msg.text || '',
      name: msg.from?.first_name
    };
  }
  threads[key].messages.push(messageItem)

  if (!answer) {
    threads[key].msgs.push(msg);
    // limit history from begin to last 20 messages
    threads[key].msgs = threads[key].msgs.slice(-20)
  }
}

export function forgetHistory(chatId: number) {
  const threads = useThreads();
  if (threads[chatId]) {
    threads[chatId].messages = [];
  }
}
