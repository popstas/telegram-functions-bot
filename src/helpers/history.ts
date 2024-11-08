import {Message} from "telegraf/types";
import {CompletionParamsType} from "../types.ts";
import OpenAI from "openai";
import {threads} from "../index.ts";

export function addToHistory({msg, answer, systemMessage, completionParams}: {
  msg: Message.TextMessage;
  answer?: string,
  systemMessage?: string;
  completionParams?: CompletionParamsType;
}) {
  const key = msg.chat?.id || 0
  if (!threads[key]) {
    threads[key] = {
      msgs: [],
      messages: [],
      customSystemMessage: systemMessage,
      completionParams: completionParams,
    }
  }
  const messageItem = {} as OpenAI.ChatCompletionMessageParam;
  if (answer) {
    messageItem.role = 'system'
    messageItem.content = answer
  } else {
    messageItem.role = 'user'
    messageItem.content = msg.text || ''
  }
  threads[key].messages.push(messageItem)

  if (!answer) threads[key].msgs.push(msg);
}

export function forgetHistory(chatId: number) {
  if (threads[chatId]) {
    threads[chatId].messages = [];
  }
}
