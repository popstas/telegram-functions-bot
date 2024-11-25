import {Message} from "telegraf/types";
import {ConfigChatType, ToolResponse} from "../types.ts";
import OpenAI from "openai";
import {callTools} from "./gpt.ts";
import {addToHistory, forgetHistory} from "./history.ts";
import {processToolResponse} from "./toolResponseHandler.ts";

export async function handleGptAnswer(
  msg: Message.TextMessage,
  res: OpenAI.ChatCompletion,
  chatConfig: ConfigChatType,
  expressRes: express.Response | undefined,
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

  if (thread.messages.find(m => m.role === 'tool') && chatConfig.chatParams.memoryless) {
    forgetHistory(msg.chat.id);
  }
  
  return {content: answer};
}
