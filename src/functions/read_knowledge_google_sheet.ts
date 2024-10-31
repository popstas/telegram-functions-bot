import {aiFunction, AIFunctionsProvider} from '@agentic/core';
import { z } from 'zod';
import {ConfigChatType, ConfigType, ThreadStateType, ToolResponse} from "../types.ts";
import {readConfig} from "../config.ts";
import readGoogleSheet from "../helpers/readGoogleSheet.ts";
import {OAuth2Client} from "google-auth-library";

type ToolArgsType = {
  title: string
}

let client: KnowledgeGoogleSheetClient | undefined;
let cache: Object[] = [];
let answerFunc: Function

export class KnowledgeGoogleSheetClient extends AIFunctionsProvider {
  protected readonly config: ConfigType
  protected readonly configChat: ConfigChatType
  private oauth2Client: OAuth2Client;

  constructor(configChat: ConfigChatType, oauth2Client: OAuth2Client) {
    super()

    this.config = readConfig();
    this.configChat = configChat
    this.oauth2Client = oauth2Client;
  }

  async read_sheet() {
    if (cache.length) return cache;
    if (!this.oauth2Client?.credentials?.access_token) {
      // return { content: 'No access token, auth with /google_auth' };
      return
    }

    if (!this?.configChat?.options?.knowledge_google_sheet.sheetId) {
      return
    }

    const data = await readGoogleSheet(this.configChat.options.knowledge_google_sheet.sheetId, this.oauth2Client);
    cache = data;
    return data
  }

  @aiFunction({
    name: 'read_knowledge_google_sheet',
    description: 'Read the contents of an Obsidian file',
    inputSchema: z.object({
      title: z
        .string()
        .describe(
          'Title of the question'
        ),
    })
  })
  async read_knowledge_google_sheet(options: ToolArgsType): Promise<ToolResponse> {
    const title = options.title;

    if (typeof answerFunc === 'function') {
      void answerFunc(`\`read_knowledge_google_sheet(${title})\``);
    }

    const data = await this.read_sheet();
    if (!data) return {content: 'No access token, auth with /google_auth'};
    const titleCol = this.configChat.options?.knowledge_google_sheet.titleCol || 'title';
    const textCol = this.configChat.options?.knowledge_google_sheet.textCol || 'text';
    const found = data?.find((row: any) => row[titleCol] === title);
    // @ts-ignore
    const content = found ? found[textCol] :  `No answer found for ${title}`;
    return {content, args: {command: options.title}};
  }
}

export async function prompt_append(configChat: ConfigChatType): Promise<string | undefined> {
  if (!client) return "";
  const data = await client.read_sheet();
  const titleCol = configChat.options?.knowledge_google_sheet.titleCol || 'title';
  const titles = data?.map((row: any) => row[titleCol]);
  if (titles) return '## Google Sheet Knowledge base titles:\n' + titles.map(f => `- ${f}`).join('\n');
}

export function call(configChat: ConfigChatType, thread: ThreadStateType) {
  const oauth2Client = thread?.oauth2Client as OAuth2Client;
  if (!client) client = new KnowledgeGoogleSheetClient(configChat, oauth2Client);
  return client;
}

export function setAnswerFunc(val: Function) {
  answerFunc = val
}