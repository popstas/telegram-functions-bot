import { Message } from 'telegraf/types'
import OpenAI from "openai";

export type ConfigChatType = {
  name: string
  id: number
  username?: string
  prefix?: string
  progPrefix?: string
  progInfoPrefix?: string
  forgetPrefix?: string
  systemMessage?: string
  completionParams?: CompletionParamsType
  debug?: boolean
  memoryless?: boolean
  buttons?: ConfigChatButtonType[]
}

export type CompletionParamsType = {
  model: string
  temperature?: number
  top_p?: number
  presence_penalty?: number
  max_tokens: number
}

export type ConfigType = {
  bot_name: string
  debug?: boolean
  isTest?: boolean
  auth: {
    bot_token: string
    chatgpt_api_key: string
  }
  proxyUrl?: string
  helpText: string
  systemMessage?: string
  timeoutMs?: number
  completionParams: CompletionParamsType
  allowedPrivateUsers?: string[]
  testUsers?: string[]
  chats: ConfigChatType[]
  planfix: PlanfixConfigType
  functions: {
    ssh: SshConfigType
  }
}

export type SshConfigType = {
  host: string
  user: string
}

export type ThreadStateType = {
  partialAnswer: string
  history: Message.TextMessage[]
  messages: OpenAI.ChatCompletionMessageParam[]
  customSystemMessage?: string
  completionParams?: CompletionParamsType
  activeButton?: ConfigChatButtonType
  nextSystemMessage?: string
}

export type ConfigChatButtonType = {
  name: string
  prompt: string
  row?: number
  waitMessage?: string
}

export type PlanfixConfigType = {
  account: string
  api_url: string
  token: string
  user_login: string
  user_password: string
  templateId: number
}

export interface ToolResponse {
  content: string
  args?: {
    command?: string
  }
}
