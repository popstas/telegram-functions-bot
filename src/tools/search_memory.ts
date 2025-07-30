import { aiFunction, AIFunctionsProvider } from "@agentic/core";
import { z } from "zod";
import type { ConfigChatType, ToolResponse } from "../types.ts";
import { searchEmbedding } from "../helpers/embeddings.ts";

export const description = "Search stored chat memory";
export const details = `- searches vector memory for similar snippets\n- dbPath: toolParams.vectorMemory.dbPath`;

export const defaultParams = {
  vectorMemory: {
    dbPath: "data/memory.sqlite",
    dimension: 1536,
  },
};

export class SearchMemoryClient extends AIFunctionsProvider {
  protected readonly configChat: ConfigChatType;

  constructor(configChat: ConfigChatType) {
    super();
    this.configChat = configChat;
  }

  @aiFunction({
    name: "search_memory",
    description,
    inputSchema: z.object({
      query: z.string().describe("Search query"),
      limit: z.number().optional().default(3),
    }),
  })
  async search_memory({
    query,
    limit = 3,
  }: {
    query: string;
    limit?: number;
  }): Promise<ToolResponse> {
    const rows = await searchEmbedding({ query, limit, chat: this.configChat });
    const content = rows.map((r) => `${r.date} ${r.text}`).join("\n");
    return { content };
  }

  options_string(str: string) {
    const { query } = JSON.parse(str) as { query: string };
    if (!query) return str;
    return `**Memory search:** \`${query}\``;
  }
}

export function call(configChat: ConfigChatType) {
  return new SearchMemoryClient(configChat);
}
