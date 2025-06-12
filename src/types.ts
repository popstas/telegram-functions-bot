import { Message } from "telegraf/types";
import OpenAI from "openai";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { CredentialBody } from "google-auth-library/build/src/auth/credentials";

export type ToolBotType = {
  agent_name?: string;
  bot_name?: string; // deprecated
  name: string;
  description?: string;
  tool_use_behavior?: "run_llm_again" | "stop_on_first_tool";
  prompt_append?: string;
};

export type ChatEvaluatorType = {
  agent_name: string;
  threshold?: number;
  maxIterations?: number;
};

export type ConfigChatType = {
  name: string;
  local_model?: string;
  completionParams: CompletionParamsType;
  bot_token?: string;
  bot_name?: string; // deprecated
  agent_name?: string;
  privateUsers?: string[];
  id?: number;
  ids?: number[];
  username?: string;
  prefix?: string;
  systemMessage?: string;
  buttons?: ConfigChatButtonType[];
  buttonsSync?: ButtonsSyncConfigType;
  buttonsSynced?: ConfigChatButtonType[];
  http_token?: string;
  tools?: (string | ToolBotType)[];
  evaluators?: ChatEvaluatorType[];
  chatParams: ChatParamsType;
  toolParams: ToolParamsType;
};

export type ChatParamsType = {
  confirmation?: boolean;
  deleteToolAnswers?: number;
  debug?: boolean; // TODO: impl
  memoryless?: boolean;
  forgetTimeout?: number; // in seconds
  showToolMessages?: true | false | undefined | "headers";
  showTelegramNames?: boolean;
};

export type CompletionParamsType = {
  model: string;
  temperature?: number;
  top_p?: number;
  presence_penalty?: number;
  max_tokens?: number;
};

export type ConfigType = {
  bot_name: string; // TODO: use ctx.botInfo.username
  debug?: boolean;
  isTest?: boolean;
  auth: {
    bot_token: string;
    chatgpt_api_key: string;
    google_service_account?: CredentialBody;
    oauth_google?: {
      client_id: string;
      client_secret: string;
      redirect_uri: string;
    };
    proxy_url?: string;
  };
  local_models: {
    name: string;
    url: string;
    model: string;
  }[];
  http: HttpConfigType;
  mqtt?: MqttConfigType;
  adminUsers?: string[];
  privateUsers: string[];
  testUsers?: string[];
  mcpServers?: Record<string, McpToolConfig>;
  stt?: {
    whisperBaseUrl?: string;
  };
  vision?: {
    model: string;
  };
  chats: ConfigChatType[];
  logLevel?: "debug" | "info" | "warn" | "error";
  langfuse?: {
    secretKey: string;
    publicKey: string;
    baseUrl: string;
  };
};

export type HttpConfigType = {
  port?: number;
  telegram_from_username?: string;
  http_token?: string;
  webhook?: string;
};

export type MqttConfigType = {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  base: string;
};

export type ButtonsSyncConfigType = {
  sheetId: string;
  sheetName: string;
};

export type SshConfigType = {
  host: string;
  user: string;
  strictHostKeyChecking?: boolean;
};

export type ObsidianConfigType = {
  root_path: string;
  out_file: string;
};

export type ThreadStateType = {
  id: number;
  msgs: Message.TextMessage[];
  messages: OpenAI.ChatCompletionMessageParam[];
  completionParams?: CompletionParamsType;
  activeButton?: ConfigChatButtonType;
  nextSystemMessage?: string;
  authClient?: OAuth2Client | GoogleAuth;
};

export type ConfigChatButtonType = {
  name: string;
  prompt: string;
  row?: number;
  waitMessage?: string;
};

export type ChatToolType = {
  name: string;
  module: {
    call: (chatConfig: ConfigChatType, thread: ThreadStateType) => ModuleType;
    defaultParams?: ToolParamsType;
    description?: string;
  };
};

export type ModuleType = {
  functions: {
    get: (name: string) => (args: string) => Promise<ToolResponse>;
    toolSpecs: OpenAI.ChatCompletionTool;
  };
  mcp?: boolean;
  agent?: boolean;
  options_string?: (args: string) => string;
  systemMessage?: () => string;
  prompt_append?: () => string;
  thread?: ThreadStateType;
  configChat?: ConfigChatType;
};

export interface ToolResponse {
  content: string;
}

export type BrainstormParamsType = {
  promptBefore?: string;
  promptAfter?: string;
};

export type GptContextType = {
  thread: ThreadStateType;
  messages: OpenAI.ChatCompletionMessageParam[];
  systemMessage: string;
  chatTools: ChatToolType[];
  prompts: string[];
  tools: OpenAI.ChatCompletionTool[] | undefined;
};

export type ToolParamsType = {
  brainstorm?: BrainstormParamsType;
  obsidian?: ObsidianConfigType;
  ssh_command?: SshConfigType;
  knowledge_google_sheet?: {
    sheetId: string;
    titleCol: string;
    textCol: string;
  };
  knowledge_json?: {
    jsonPath: string;
    jsonUrl: string;
    titleCol: string;
    textCol: string;
    cacheTime: number;
  };
  planfix?: {
    account: string;
    token: string;
  };
  planfix_create_request_task?: {
    name: string;
    templateId?: number;
    contactTemplateId?: number;
    daysToSearch?: number;
    contactsMap?: Array<{
      title: string;
      field_name: string;
    }>;
    fieldIds?: {
      [key: string]: number;
    };
    contactsGroups: {
      agents: number;
      contacts: number;
      suppliers: number;
    };
    contactsTemplates: {
      agents: number;
      contacts: number;
      suppliers: number;
    };
    dryRun?: boolean;
  };
};

// MCP tool configuration
export interface McpToolConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  serverUrl?: string;
}
