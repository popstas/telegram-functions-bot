import { aiFunction, AIFunctionsProvider } from "@agentic/core";
import { z } from "zod";
import {
  ConfigChatType,
  ConfigType,
  ThreadStateType,
  ToolResponse,
} from "../types.ts";
import { readConfig } from "../config.ts";
import readGoogleSheetToRows from "../helpers/readGoogleSheet.ts";
import { GoogleAuth, OAuth2Client } from "google-auth-library";

type ToolArgsType = {
  title: string;
};

export const description = "Read the contents of Google Sheet by titles list";
export const details = `- read titles and includes it to prompt
- when answer, read the content from the sheet by title
- text part should be larger than title 
- sheetId: toolParams.knowledge_google_sheet.sheetId
- titleCol: toolParams.knowledge_google_sheet.titleCol
- textCol: toolParams.knowledge_google_sheet.textCol`;
export const defaultParams = {
  knowledge_google_sheet: {
    sheetId: "sheet_id",
    titleCol: "title",
    textCol: "text",
  },
};

const cache: { [sheetId: string]: object[] } = {};
function getCache(sheetId: string) {
  return cache[sheetId];
}
function setCache(sheetId: string, data: object[]) {
  cache[sheetId] = data;
}

export class KnowledgeGoogleSheetClient extends AIFunctionsProvider {
  protected readonly config: ConfigType;
  protected readonly configChat: ConfigChatType;
  private readonly authClient?: OAuth2Client | GoogleAuth;

  constructor(
    configChat: ConfigChatType,
    authClient?: OAuth2Client | GoogleAuth,
  ) {
    super();
    this.config = readConfig();
    this.configChat = configChat;
    this.authClient = authClient;
  }

  async read_sheet() {
    if (!this.authClient) return [];
    const sheetId = this.configChat.toolParams?.knowledge_google_sheet?.sheetId;
    if (!sheetId) return;

    if (getCache(sheetId)) return getCache(sheetId);

    const data = (await readGoogleSheetToRows(sheetId, this.authClient)) || [];
    setCache(sheetId, data);
    return data;
  }

  @aiFunction({
    name: "read_knowledge_google_sheet",
    description,
    inputSchema: z.object({
      title: z.string().describe("Title of the question"),
    }),
  })
  async read_knowledge_google_sheet(
    options: ToolArgsType,
  ): Promise<ToolResponse> {
    const title = options.title;

    const data = (await this.read_sheet()) as Array<{ [key: string]: string }>;
    if (!data.length) return { content: "No data, auth with /google_auth" };
    const titleCol =
      this.configChat.toolParams?.knowledge_google_sheet?.titleCol || "title";
    const textCol =
      this.configChat.toolParams?.knowledge_google_sheet?.textCol || "text";
    const found = data.find(
      (row: { [key: string]: string }) => row[titleCol] === title,
    );
    const content = found ? found[textCol] : `No answer found for ${title}`;
    return { content };
  }

  options_string(str: string) {
    const { title } = JSON.parse(str) as ToolArgsType;
    if (!title) return str;
    return `**Google sheet:** \`${title}\``;
  }

  async prompt_append(): Promise<string | undefined> {
    const data = await this.read_sheet();
    const titleCol =
      this.configChat.toolParams?.knowledge_google_sheet?.titleCol || "title";
    // @ts-expect-error: headers are dynamic
    const titles = data?.map((row: { [key: string]: string }) => row[titleCol]);
    if (titles)
      return (
        "## Google Sheet Knowledge base titles:\n" +
        titles.map((f) => `- ${f}`).join("\n")
      );
  }
}

export function call(configChat: ConfigChatType, thread: ThreadStateType) {
  return new KnowledgeGoogleSheetClient(configChat, thread?.authClient);
}
