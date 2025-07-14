import { aiFunction, AIFunctionsProvider } from "@agentic/core";
import { z } from "zod";
import { readConfig } from "../config.ts";
import {
  BrainstormParamsType,
  ConfigChatType,
  ConfigType,
  ThreadStateType,
} from "../types.ts";
import { buildMessages } from "../helpers/gpt.ts";
import { llmCall } from "../helpers/gpt.ts";
import { Message } from "telegraf/types";

type ToolArgsType = {
  systemMessage: string;
};

export const description = "Useful tool for brainstorming and planning task";

// export const configFields = ['user', 'host']
export const defaultParams = {
  brainstorm: {
    promptBefore: "",
    promptAfter: "",
  } as BrainstormParamsType,
};

export class BrainstormClient extends AIFunctionsProvider {
  protected readonly config: ConfigType;
  protected readonly configChat: ConfigChatType;
  protected readonly thread: ThreadStateType;

  constructor(configChat: ConfigChatType, thread: ThreadStateType) {
    super();
    this.config = readConfig();
    this.configChat = configChat;
    this.thread = thread;
  }

  @aiFunction({
    name: "brainstorm",
    description,
    inputSchema: z.object({
      systemMessage: z.string().describe("Prompt for brainstorming"),
    }),
  })
  async brainstorm(options: ToolArgsType) {
    const toolParams = this.configChat.toolParams?.brainstorm;
    const prompt = toolParams?.promptBefore;
    const systemMessage =
      options.systemMessage + (prompt ? `\n\n${prompt}` : "");

    const thread = this.thread;
    const messages = await buildMessages(systemMessage, thread.messages);

    const msg = thread.msgs[thread.msgs.length - 1] as Message.TextMessage;
    const { res } = await llmCall({
      apiParams: {
        messages,
        model: thread.completionParams?.model || "gpt-4o-mini",
        temperature: thread.completionParams?.temperature,
      },
      msg,
      chatConfig: this.configChat,
      noSendTelegram: true,
    });

    const content =
      (res.choices[0]?.message.content || "") +
      (toolParams?.promptAfter ? `\n\n${toolParams.promptAfter}` : "");
    return { content };
  }

  options_string(str: string) {
    const { systemMessage } = JSON.parse(str) as ToolArgsType;
    if (!systemMessage) return str;
    return `**Brainstorm:** \`${systemMessage}\``;
  }
}

export function call(configChat: ConfigChatType, thread: ThreadStateType) {
  return new BrainstormClient(configChat, thread);
}
