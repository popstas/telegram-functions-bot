import {Message} from 'telegraf/types'
import OpenAI from "openai";
import {GoogleAuth, OAuth2Client} from 'google-auth-library';
import {CredentialBody} from "google-auth-library/build/src/auth/credentials";

export type ConfigChatType = {
  name: string
  id: number
  ids?: number[]
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
  functions?: string[]
  options?: FunctionsConfigType
  confirmation: boolean
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
    google_service_account: CredentialBody
  }
  oauth_google: {
    client_id: string
    client_secret: string
    redirect_uri: string
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
  functions: string[]
}

export type SshConfigType = {
  host: string
  user: string
}

export type ObsidianConfigType = {
  root_path: string
  out_file: string
}

export type ThreadStateType = {
  msgs: Message.TextMessage[]
  messages: OpenAI.ChatCompletionMessageParam[]
  customSystemMessage?: string
  completionParams?: CompletionParamsType
  activeButton?: ConfigChatButtonType
  nextSystemMessage?: string
  oauth2Client?: OAuth2Client | GoogleAuth
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

export type FunctionsConfigType = {
  obsidian?: ObsidianConfigType
  ssh_command?: SshConfigType
  knowledge_google_sheet: {
    sheetId: string
    titleCol: string
    textCol: string
  }
}
