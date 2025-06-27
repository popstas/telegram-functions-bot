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
  const tokenizer = encodingForModel(
    chatConfig.completionParams.model as TiktokenModel,
  );
  return tokenizer.encode(text).length;
}
