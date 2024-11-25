import {Message} from "telegraf/types";
import {ConfigChatType, ToolResponse} from "../types.ts";
import OpenAI from "openai";
import {sendToHttp} from "../helpers.ts";
import {sendTelegramMessage} from "./telegram.ts";
import {buildMessages} from "./gpt.ts";
import {useApi} from "./useApi.ts";

export async function processToolResponse(
  tool_res: ToolResponse[],
  messageAgent: OpenAI.ChatCompletionMessage,
  thread: any,
  chatConfig: ConfigChatType,
  msg: Message.TextMessage,
  expressRes: any,
  messages: any,
  systemMessage: string,
  chatTools: any,
  prompts: any,
  tools: any,
  level: number
): Promise<ToolResponse> {
  thread.messages.push(messageAgent);
  
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

    thread.messages.push(messageTool);
  }

  messages = await buildMessages(systemMessage, thread.messages, chatTools, prompts);

  const isNoTool = level > 6 || !tools?.length;

  const api = useApi();
  const res = await api.chat.completions.create({
    messages,
    model: thread.completionParams?.model || 'gpt-4o-mini',
    temperature: thread.completionParams?.temperature,
    tools: isNoTool ? undefined : tools,
    tool_choice: isNoTool ? undefined : 'auto',
  });

  return await handleGptAnswer(msg, res, thread, chatConfig, expressRes, messages, systemMessage, chatTools, prompts, tools, level + 1);
}
