import { aiFunction, AIFunctionsProvider } from "@agentic/core";
import { z } from "zod";
import { generatePrivateChatConfig, readConfig, writeConfig } from "../config.ts";
import {
  ConfigChatType,
  ConfigType,
  ChatParamsType,
  ToolResponse,
  ThreadStateType,
} from "../types.ts";

type ToolArgsType = ChatParamsType;

const description = "Change chat settings in config.yml";
const details = `- Change chat settings in config.yml
- Change any chatParams settings
- If private chat not found, create new chat with settings
- If group chat not found, ignore`;

export class ChangeChatSettingsClient extends AIFunctionsProvider {
  protected readonly config: ConfigType;
  protected readonly configChat: ConfigChatType;
  protected readonly thread: ThreadStateType;
  protected readonly details: string;

  constructor(configChat: ConfigChatType, thread: ThreadStateType) {
    super();
    this.config = readConfig();
    this.configChat = configChat;
    this.thread = thread;
    this.details = details;
  }

  @aiFunction({
    name: "change_chat_settings",
    description,
    inputSchema: z.object({
      confirmation: z
        .boolean()
        .optional()
        .describe("Whether to ask for confirmation before running a tool"),
      deleteToolAnswers: z
        .number()
        .optional()
        .describe("Whether to delete tool answers after a certain time"),
      debug: z.boolean().optional(),
      memoryless: z
        .boolean()
        .optional()
        .describe("Whether to forget the context after each message"),
      forgetTimeout: z.number().optional().describe("Time in seconds to forget the context after"),
      showToolMessages: z
        .union([z.boolean(), z.literal("headers")])
        .optional()
        .describe("Whether to show tool messages, headers means only tool calls"),
    }),
  })
  async change_chat_settings(settings: ToolArgsType) {
    const config = readConfig();
    const privateChatConfig = config.chats.find(
      (chat) => this.configChat.username && chat.username === this.configChat.username,
    );
    const groupChatConfig = config.chats.find(
      (chat) => chat.id === this.thread.id || chat.ids?.includes(this.thread.id),
    );
    const chatConfig = groupChatConfig || privateChatConfig;

    if (!chatConfig) {
      const newChatConfig = generatePrivateChatConfig(
        this.configChat.username || "without_username",
      );
      newChatConfig.chatParams = settings;
      config.chats.push(newChatConfig);
    } else {
      if (!chatConfig.chatParams) chatConfig.chatParams = {};
      Object.assign(chatConfig.chatParams, settings);
    }

    writeConfig("config.yml", config);

    return { content: "Chat settings updated successfully" } as ToolResponse;
  }

  options_string(str: string) {
    const settings = JSON.parse(str) as ToolArgsType;
    if (!settings) return str;
    const settingsStr = Object.entries(settings)
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ");
    return `**Change settings:** \`${settingsStr}\``;
  }
}

export function call(configChat: ConfigChatType, thread: ThreadStateType) {
  return new ChangeChatSettingsClient(configChat, thread);
}
