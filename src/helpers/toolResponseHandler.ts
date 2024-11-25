import {Message} from "telegraf/types";
import {ConfigChatType, GptContextType, ToolResponse} from "../types.ts";
import OpenAI from "openai";
import {sendToHttp} from "../helpers.ts";
import {sendTelegramMessage} from "./telegram.ts";
import {buildMessages} from "./gpt.ts";
import {useApi} from "./useApi.ts";
import {Response} from "express";
import {handleGptAnswer} from "./gptAnswerHandler.ts";

export async function processToolResponse(
  tool_res: ToolResponse[],
  messageAgent: OpenAI.ChatCompletionMessage,
  chatConfig: ConfigChatType,
  msg: Message.TextMessage,
  expressRes: Response | undefined,
  gptContext: GptContextType,
  level: number
): Promise<ToolResponse> {
  gptContext.thread.messages.push(messageAgent);
  
  for (let i = 0; i < tool_res.length; i++) {
    const toolRes = tool_res[i];
    const toolCall = (messageAgent as {
      tool_calls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]
    }).tool_calls[i];

    if (chatConfig.chatParams?.showToolMessages === true || chatConfig.chatParams?.showToolMessages === undefined) {
      const params = {parse_mode: 'MarkdownV2', deleteAfter: chatConfig.chatParams?.deleteToolAnswers};
      const toolResMessageLimit = 8000;
      const msgContentLimited = toolRes.content.length > toolResMessageLimit ? 
        toolRes.content.slice(0, toolResMessageLimit) + '...' : 
        toolRes.content;
      sendToHttp(expressRes, msgContentLimited);
      void sendTelegramMessage(msg.chat.id, msgContentLimited, params);
    }

    const messageTool = {
      role: 'tool',
      content: toolRes.content,
      tool_call_id: toolCall.id,
    } as OpenAI.ChatCompletionToolMessageParam;

    gptContext.thread.messages.push(messageTool);
  }

  gptContext.messages = await buildMessages(
    gptContext.systemMessage, 
    gptContext.thread.messages, 
    gptContext.chatTools, 
    gptContext.prompts
  );

  const isNoTool = level > 6 || !gptContext.tools?.length;

  const api = useApi();
  const res = await api.chat.completions.create({
    messages: gptContext.messages,
    model: gptContext.thread.completionParams?.model || 'gpt-4o-mini',
    temperature: gptContext.thread.completionParams?.temperature,
    tools: isNoTool ? undefined : gptContext.tools,
    tool_choice: isNoTool ? undefined : 'auto',
  });

  return await handleGptAnswer(msg, res, chatConfig, expressRes, gptContext, level + 1);
}
