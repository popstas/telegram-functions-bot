import { aiFunction, AIFunctionsProvider } from '@agentic/core';
import { z } from 'zod';
import { readConfig, writeConfig } from '../config';
import {
  ConfigChatType,
  ConfigType,
  ChatSettingsType,
  ToolResponse,
  FunctionsConfigType,
  ThreadStateType
} from '../types';

type ToolArgsType = {
  settings: ChatSettingsType;
};

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
      settings: z.object({
        confirmation: z.boolean().optional(),
        deleteToolAnswers: z.union([z.boolean(), z.number()]).optional(),
        debug: z.boolean().optional(),
        memoryless: z.boolean().optional(),
      }).describe('Chat settings to be updated'),
    }),
  })
  async change_chat_settings({ settings }: ToolArgsType) {
    const config = readConfig();
    const chatConfig = config.chats.find(chat => chat.username === this.configChat.username);

    if (!chatConfig) {
      const newChatConfig: ConfigChatType = {
        name: `Private ${this.configChat.username}`,
        username: this.configChat.username,
        completionParams: config.completionParams,
        toolParams: {} as FunctionsConfigType,
        chatParams: settings,
      };
      config.chats.push(newChatConfig);
    } else {
      if (!chatConfig.chatParams) chatConfig.chatParams = {};
      Object.assign(chatConfig.chatParams, settings);
    }

    writeConfig('config.yml', config);

    return { content: 'Chat settings updated successfully' } as ToolResponse;
  }

  options_string(str: string) {
    const {settings} = JSON.parse(str) as ToolArgsType;
    if (!settings) return str
    const settingsStr = Object.entries(settings).map(([key, value]) => `${key}: ${value}`).join(', ');
    return `**Change settings:** \`${settingsStr}\``
  }
}

export function call(configChat: ConfigChatType, thread: ThreadStateType) {
  return new ChangeChatSettingsClient(configChat);
}
