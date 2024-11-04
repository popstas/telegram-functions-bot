import {aiFunction, AIFunctionsProvider} from '@agentic/core';
import {z} from 'zod';
import {ConfigChatType, ConfigType, ThreadStateType, ToolResponse} from "../types.ts";
import {readConfig} from "../config.ts";
import readGoogleSheet from "../helpers/readGoogleSheet.ts";
import {OAuth2Client} from "google-auth-library";

type ToolArgsType = {
  title: string
}

let cache: { [sheetId: string]: Object[] } = {};

function getCache(sheetId: string) {
  return cache[sheetId];
}

function setCache(sheetId: string, data: Object[]) {
  cache[sheetId] = data;
}

export class KnowledgeGoogleSheetClient extends AIFunctionsProvider {
  protected readonly config: ConfigType
  public readonly configChat: ConfigChatType
  private readonly oauth2Client: OAuth2Client;

  constructor(configChat: ConfigChatType, oauth2Client: OAuth2Client) {
    super()
    this.config = readConfig();
    this.configChat = configChat
    this.oauth2Client = oauth2Client;
  }

  async read_sheet() {
    const sheetId = this?.configChat?.toolParams?.knowledge_google_sheet.sheetId
    if (!sheetId) return

    if (getCache(sheetId)) return getCache(sheetId);

    const data = await readGoogleSheet(sheetId, this.oauth2Client);
    setCache(sheetId, data);
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

    const data = await this.read_sheet();
    if (!data) return {content: 'No data, auth with /google_auth'};
    const titleCol = this.configChat.toolParams?.knowledge_google_sheet.titleCol || 'title';
    const textCol = this.configChat.toolParams?.knowledge_google_sheet.textCol || 'text';
    const found = data?.find((row: any) => row[titleCol] === title);
    const content = found ? found[textCol] : `No answer found for ${title}`;
    return {content};
  }

  options_string(str: string) {
    const {title} = JSON.parse(str) as ToolArgsType;
    if (!title) return str
    return `**Google sheet:** \`${title}\``
  }

  async prompt_append(): Promise<string | undefined> {
    const data = await this.read_sheet();
    const titleCol = this.configChat.toolParams?.knowledge_google_sheet.titleCol || 'title';
    const titles = data?.map((row: any) => row[titleCol]);
    if (titles) return '## Google Sheet Knowledge base titles:\n' + titles.map(f => `- ${f}`).join('\n');
  }
}

export function call(configChat: ConfigChatType, thread: ThreadStateType) {
  const oauth2Client = thread?.oauth2Client as OAuth2Client;
  return new KnowledgeGoogleSheetClient(configChat, oauth2Client);
}
