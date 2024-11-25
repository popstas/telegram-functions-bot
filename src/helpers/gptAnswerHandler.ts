import {Message} from "telegraf/types";
import {ConfigChatType, GptContextType, ToolResponse} from "../types.ts";
import OpenAI from "openai";
import {callTools} from "./gpt.ts";
import {addToHistory, forgetHistory} from "./history.ts";
import {processToolResponse} from "./toolResponseHandler.ts";
import {Response} from "express";

export async function handleGptAnswer(
  msg: Message.TextMessage,
  res: OpenAI.ChatCompletion,
  chatConfig: ConfigChatType,
  expressRes: Response | undefined,
  gptContext: GptContextType,
  level: number = 1
): Promise<ToolResponse> {
  const messageAgent = res.choices[0]?.message!;
  
  if (messageAgent.tool_calls?.length) {
    const tool_res = await callTools(messageAgent.tool_calls, gptContext.chatTools, chatConfig, msg, expressRes);
    if (tool_res) {
      return processToolResponse(
        tool_res,
        messageAgent,
        chatConfig,
        msg,
        expressRes,
        gptContext,
        level
      );
    }
  }

  const answer = res.choices[0]?.message.content || '';
  addToHistory({msg, answer});

  if (gptContext.thread.messages.find((m: OpenAI.ChatCompletionMessageParam) => m.role === 'tool') && chatConfig.chatParams.memoryless) {
    forgetHistory(msg.chat.id);
  }
  
  return {content: answer};
}
