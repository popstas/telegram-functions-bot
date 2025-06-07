import OpenAI from "openai";
import { getEncoding, TiktokenEncoding } from "js-tiktoken";
import { ChatToolType, ConfigChatType, ThreadStateType } from "../../types.ts";
import { getToolsPrompts, getToolsSystemMessages } from "./tools.ts";

export async function buildMessages(
  systemMessage: string,
  history: OpenAI.ChatCompletionMessageParam[],
) {
  const limit = 7; // TODO: to config
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: systemMessage,
    },
  ];

  history = history.slice(-limit);

  if (history.length && history[0].role === "tool") {
    history.shift();
  }

  messages.push(...history);

  return messages;
}

export async function getSystemMessage(
  chatConfig: ConfigChatType,
  chatTools: ChatToolType[],
): Promise<string> {
  const systemMessages = await getToolsSystemMessages(
    chatTools,
    chatConfig,
    {} as ThreadStateType,
  );
  const system =
    chatConfig.systemMessage ||
    systemMessages[0] ||
    "You are using functions to answer the questions. Current date: {date}";
  const prompts = await getToolsPrompts(
    chatTools,
    chatConfig,
    {} as ThreadStateType,
  );
  return system + (prompts.length ? `\n\n${prompts.join("\n\n")}` : "");
}

export function getTokensCount(chatConfig: ConfigChatType, text: string) {
  const encoding: TiktokenEncoding = chatConfig.completionParams.model.includes(
    "4o",
  )
    ? "o200k_base"
    : "cl100k_base";
  const tokenizer = getEncoding(encoding);
  return tokenizer.encode(text).length;
}
