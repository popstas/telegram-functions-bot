import { aiFunction, AIFunctionsProvider } from "@agentic/core";
import { z } from "zod";
import { ConfigChatType, ConfigType, ToolResponse } from "../types";
import { readConfig } from "../config";
import { readFileSync } from "fs";

interface JsonRow {
  [key: string]: unknown;
  title?: string;
  text?: string;
}

type ToolArgsType = {
  title: string;
};

export const description =
  "Read the contents of a JSON file from a URL or local file by titles list";
export const details = `- read titles and includes it to prompt
- when answer, read the text by title
- jsonPath: toolParams.knowledge_json.jsonPath - local file
- jsonUrl: toolParams.knowledge_json.jsonUrl - or url, cached for 1 hour
- titleCol: toolParams.knowledge_json.titleCol
- textCol: toolParams.knowledge_json.textCol
- cacheTime: toolParams.knowledge_json.cacheTime - seconds`;

export const defaultParams = {
  knowledge_json: {
    jsonPath: "/path/to/json",
    jsonUrl: "or url",
    titleCol: "title",
    textCol: "text",
  },
};

interface CacheEntry {
  data: JsonRow[];
  expiry: number;
}

const cache: Record<string, CacheEntry> = {};

function getCache(path: string): JsonRow[] | null {
  const cached = cache[path];
  if (cached && cached.expiry > Date.now()) {
    return cached.data;
  }
  return null;
}

function setCache(path: string, data: JsonRow[], cacheTime: number): void {
  cache[path] = {
    data,
    expiry: Date.now() + cacheTime * 1000,
  };
}

export class KnowledgeJsonClient extends AIFunctionsProvider {
  protected readonly config: ConfigType;
  protected readonly configChat: ConfigChatType;
  protected readonly details: string;

  constructor(configChat: ConfigChatType) {
    super();
    this.config = readConfig();
    this.configChat = configChat;
    this.details = details;
  }

  async read_json(): Promise<JsonRow[]> {
    try {
      const opts = this?.configChat?.toolParams?.knowledge_json;
      if (!opts) return [];

      const jsonPath = opts.jsonPath;
      const jsonUrl = opts.jsonUrl;
      const cacheTime = opts.cacheTime || 3600;

      if (!jsonPath && !jsonUrl) return [];
      const path = jsonPath || jsonUrl;

      const cachedData = getCache(path);
      if (cachedData) return cachedData;

      let data: JsonRow[];
      if (path.startsWith("http://") || path.startsWith("https://")) {
        const response = await fetch(path);
        data = (await response.json()) as JsonRow[];
      } else {
        const fileContent = readFileSync(path, "utf-8");
        data = JSON.parse(fileContent) as JsonRow[];
      }

      setCache(path, data, cacheTime);
      return data || [];
    } catch (error) {
      console.error("Error reading JSON:", error);
      return [];
    }
  }

  @aiFunction({
    name: "read_knowledge_json",
    description,
    inputSchema: z.object({
      title: z.string().describe("Title of the question"),
    }),
  })
  async read_knowledge_json(options: ToolArgsType): Promise<ToolResponse> {
    const title = options.title;

    const data = await this.read_json();
    if (!data) return { content: "No data available" };
    const opts = this?.configChat?.toolParams?.knowledge_json;
    if (!opts) return { content: "No config" };
    const titleCol = opts.titleCol || "title";
    const textCol = opts.textCol || "text";
    const found = data?.find((row: JsonRow) => row[titleCol] === title);
    const content =
      found && typeof found[textCol] === "string"
        ? (found[textCol] as string)
        : `No answer found for ${title}`;
    return { content };
  }

  options_string(str: string) {
    const { title } = JSON.parse(str) as ToolArgsType;
    if (!title) return str;
    return `**JSON data:** \`${title}\``;
  }

  async prompt_append(): Promise<string | undefined> {
    const data = await this.read_json();
    const titleCol =
      this.configChat.toolParams?.knowledge_json?.titleCol || "title";
    const titles = data?.map((row: JsonRow) => {
      const value = row[titleCol];
      return typeof value === "string" ? value : String(value);
    });
    if (titles)
      return (
        "## JSON Knowledge base titles:\n" +
        titles.map((f: string) => `- ${f}`).join("\n")
      );
  }
}

export function call(configChat: ConfigChatType) {
  return new KnowledgeJsonClient(configChat);
}
