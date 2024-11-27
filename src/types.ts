import {Message} from 'telegraf/types'
import OpenAI from "openai";
import {GoogleAuth, OAuth2Client} from 'google-auth-library';
import {CredentialBody} from "google-auth-library/build/src/auth/credentials";

export type ConfigChatType = {
  name: string
  completionParams: CompletionParamsType
  id?: number
  ids?: number[]
  username?: string
  prefix?: string
  systemMessage?: string
  buttons?: ConfigChatButtonType[]
  buttonsSync?: ButtonsSyncConfigType
  buttonsSynced?: ConfigChatButtonType[]
  tools?: string[]
  chatParams: ChatParamsType
  toolParams: ToolParamsType
}

export type ChatParamsType = {
  confirmation?: boolean
  deleteToolAnswers?: boolean | number
  debug?: boolean // TODO: impl
  memoryless?: boolean
  forgetTimeout?: number // in seconds
  showToolMessages?: true | false | undefined | "headers"
}

export type CompletionParamsType = {
  model: string
  temperature?: number
  top_p?: number
  presence_penalty?: number
  max_tokens?: number
}

export type ConfigType = {
  bot_name: string // TODO: use ctx.botInfo.username
  debug?: boolean
  isTest?: boolean
  auth: {
    bot_token: string
    chatgpt_api_key: string
    google_service_account?: CredentialBody
    oauth_google?: {
      client_id: string
      client_secret: string
      redirect_uri: string
    }
    proxy_url?: string
  }
  http: HttpConfigType
  adminUsers?: string[]
  privateUsers: string[]
  testUsers?: string[]
  chats: ConfigChatType[]
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
}

export type HttpConfigType = {
  port?: number
  telegram_from_username?: string
}

export type ButtonsSyncConfigType = {
  sheetId: string
  sheetName: string
}

export type SshConfigType = {
  host: string
  user: string
  strictHostKeyChecking?: boolean
}

export type ObsidianConfigType = {
  root_path: string
  out_file: string
}

export type ThreadStateType = {
  id: number,
  msgs: Message.TextMessage[]
  messages: OpenAI.ChatCompletionMessageParam[]
  completionParams?: CompletionParamsType
  activeButton?: ConfigChatButtonType
  nextSystemMessage?: string
  authClient?: OAuth2Client | GoogleAuth
}

export type ConfigChatButtonType = {
  name: string
  prompt: string
  row?: number
  waitMessage?: string
}

export type ChatToolType = {
  name: string
  module: any
}

export interface ToolResponse {
  content: string
}

export type BrainstormParamsType = {
  promptBefore?: string
  promptAfter?: string
}

export type GptContextType = {
  thread: ThreadStateType;
  messages: OpenAI.ChatCompletionMessageParam[];
  systemMessage: string;
  chatTools: ChatToolType[];
  prompts: any[];
  tools: OpenAI.ChatCompletionTool[] | undefined;
}

export type ToolParamsType = {
  brainstorm?: BrainstormParamsType
  obsidian?: ObsidianConfigType
  ssh_command?: SshConfigType
  knowledge_google_sheet?: {
    sheetId: string
    titleCol: string
    textCol: string
  }
  knowledge_json?: {
    jsonPath: string
    jsonUrl: string
    titleCol: string
    textCol: string
    cacheTime: number
  }
  planfix?: {
    account: string
    token: string
    contactsMap?: Array<{
      title: string
      field_name: string
    }>
  }
  planfix_create_request_task?: {
    name: string
    templateId?: number
  }
}
