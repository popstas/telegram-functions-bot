import { aiFunction, AIFunctionsProvider } from '@agentic/core';
import { z } from 'zod';
import { readConfig, writeConfig } from '../config';
import {
  ConfigChatType,
  ConfigType,
  ChatSettingsType,
  ToolResponse,
  ToolParamsType,
  ThreadStateType
} from '../types';

type ToolArgsType = ChatSettingsType;

export class ChangeChatSettingsClient extends AIFunctionsProvider {
  protected readonly config: ConfigType;
  public readonly configChat: ConfigChatType;

  constructor(configChat: ConfigChatType) {
    super();
    this.config = readConfig();
    this.configChat = configChat;
  }

  @aiFunction({
    name: 'change_chat_settings',
    description: 'Change chat settings in config.yml',
    inputSchema: z.object({
      confirmation: z.boolean().optional().describe('Whether to ask for confirmation before running a tool'),
      deleteToolAnswers: z.union([z.boolean(), z.number()]).optional().describe('Whether to delete tool answers after a certain time'),
      debug: z.boolean().optional(),
      memoryless: z.boolean().optional().describe('Whether to forget the context after each message'),
      forgetTimeout: z.number().optional().describe('Time in seconds to forget the context after'),
      showToolMessages: z.union([z.boolean(), z.literal('headers')]).optional().describe('Whether to show tool messages, "headers" means only tool calls'),
    }),
  })
  async change_chat_settings(settings: ToolArgsType) {
    const config = readConfig();
    const chatConfig = config.chats.find(chat => chat.username === this.configChat.username);

    if (!chatConfig) {
      const newChatConfig = {
        name: `Private ${this.configChat.username}`,
        username: this.configChat.username,
        toolParams: {} as ToolParamsType,
        chatParams: settings,
      } as ConfigChatType;
      config.chats.push(newChatConfig);
    } else {
      if (!chatConfig.chatParams) chatConfig.chatParams = {};
      Object.assign(chatConfig.chatParams, settings);
    }

    writeConfig('config.yml', config);

    return { content: 'Chat settings updated successfully' } as ToolResponse;
  }

  options_string(str: string) {
    const settings = JSON.parse(str) as ToolArgsType;
    if (!settings) return str
    const settingsStr = Object.entries(settings).map(([key, value]) => `${key}: ${value}`).join(', ');
    return `**Change settings:** \`${settingsStr}\``
  }
}

export function call(configChat: ConfigChatType, thread: ThreadStateType) {
  return new ChangeChatSettingsClient(configChat);
}
