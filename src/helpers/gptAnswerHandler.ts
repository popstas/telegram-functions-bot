import {Message} from "telegraf/types";
import {ConfigChatType, ToolResponse} from "../types.ts";
import OpenAI from "openai";
import {callTools} from "./gpt.ts";
import {addToHistory, forgetHistory} from "./history.ts";
import {processToolResponse} from "./toolResponseHandler.ts";

export async function handleGptAnswer(
  msg: Message.TextMessage,
  res: OpenAI.ChatCompletion,
  thread: any,
  chatConfig: ConfigChatType,
  expressRes: any,
  messages: any,
  systemMessage: string,
  chatTools: any,
  prompts: any,
  tools: any,
  level: number = 1
): Promise<ToolResponse> {
  const messageAgent = res.choices[0]?.message!;
  
  if (messageAgent.tool_calls?.length) {
    const tool_res = await callTools(messageAgent.tool_calls, chatTools, chatConfig, msg, expressRes);
    if (tool_res) {
      return processToolResponse(
        tool_res, 
        messageAgent, 
        thread,
        chatConfig,
        msg,
        expressRes,
        messages,
        systemMessage,
        chatTools,
        prompts,
        tools,
        level
      );
    }
  }

  const answer = res.choices[0]?.message.content || '';
  addToHistory({msg, answer});

  if (thread.messages.find(m => m.role === 'tool') && chatConfig.chatParams.memoryless) {
    forgetHistory(msg.chat.id);
  }
  
  return {content: answer};
}
