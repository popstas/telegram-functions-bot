import OpenAI from "openai";
import { encodingForModel, TiktokenModel } from "js-tiktoken";
import { ChatToolType, ConfigChatType, ThreadStateType } from "../../types.ts";
import { getToolsPrompts, getToolsSystemMessages } from "./tools.ts";

function sanitizeName(name?: string) {
  return name ? name.replace(/[\s<>|/]/g, "").slice(0, 64) : undefined;
}

export async function buildMessages(
  systemMessage: string,
  history: OpenAI.ChatCompletionMessageParam[],
) {
  const limit = 20; // TODO: to config
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: systemMessage,
    },
  ];

  history = history.slice(-limit);

  // remove tool messages without preceding assistant tool call
  const filteredHistory: OpenAI.ChatCompletionMessageParam[] = [];
  const availableToolIds = new Set<string>();

  for (const msg of history) {
    if (
      msg.role === "assistant" &&
      (msg as OpenAI.ChatCompletionAssistantMessageParam).tool_calls
    ) {
      for (const call of (msg as OpenAI.ChatCompletionAssistantMessageParam)
        .tool_calls as OpenAI.ChatCompletionMessageToolCall[]) {
        availableToolIds.add(call.id);
      }
      filteredHistory.push(msg);
    } else if (msg.role === "tool") {
      const id = (msg as OpenAI.ChatCompletionToolMessageParam).tool_call_id;
      if (availableToolIds.has(id)) {
        filteredHistory.push(msg);
      }
    } else {
      filteredHistory.push(msg);
    }
  }

  history = filteredHistory;

  messages.push(
    ...history.map((m) => {
      const msg = { ...m } as OpenAI.ChatCompletionMessageParam & {
        name?: string;
      };
      if (msg.name) {
        msg.name = sanitizeName(msg.name);
      }
      return msg;
    }),
  );

  return messages;
}

export async function getSystemMessage(
  chatConfig: ConfigChatType,
  chatTools: ChatToolType[],
  thread: ThreadStateType = { messages: [], msgs: [], id: 0 },
): Promise<string> {
  const systemMessages = await getToolsSystemMessages(chatTools, chatConfig, thread);
  const system =
    chatConfig.systemMessage ||
    systemMessages[0] ||
    "You are using functions to answer the questions. Current date: {date}";
  const prompts = await getToolsPrompts(chatTools, chatConfig, thread);
  return system + (prompts.length ? `\n\n${prompts.join("\n\n")}` : "");
}

export function getTokensCount(chatConfig: ConfigChatType, text: string) {
  try {
    const tokenizer = encodingForModel(chatConfig.completionParams.model as TiktokenModel);
    return tokenizer.encode(text).length;
  } catch (error) {
    console.error(error);
    console.error("model:", chatConfig.completionParams.model);
    return 0;
  }
}
