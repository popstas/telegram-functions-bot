import { aiFunction, AIFunctionsProvider } from '@agentic/core';
import { z } from 'zod';
import { readConfig, writeConfig } from '../config';
import { ConfigChatType, ConfigType, ChatSettingsType, ToolResponse } from '../types';

type ToolArgsType = {
  settings: ChatSettingsType;
};

let client: ChangeChatSettingsClient | undefined;

export class ChangeChatSettingsClient extends AIFunctionsProvider {
  protected readonly config: ConfigType;
  public readonly answerFunc: Function;
  public readonly configChat: ConfigChatType;

  constructor(configChat: ConfigChatType, answerFunc: Function) {
    super();
    this.config = readConfig();
    this.answerFunc = answerFunc;
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
        toolParams: {},
        chatParams: settings,
      };
      config.chats.push(newChatConfig);
    } else {
      Object.assign(chatConfig.chatParams, settings);
    }

    writeConfig('config.yml', config);

    return { content: 'Chat settings updated successfully' } as ToolResponse;
  }
}

export function call(configChat: ConfigChatType, thread: ThreadStateType, answerFunc: Function) {
  if (!client) client = new ChangeChatSettingsClient(configChat, answerFunc);
  return client;
}
