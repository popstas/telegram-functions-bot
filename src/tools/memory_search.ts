import { aiFunction, AIFunctionsProvider } from "@agentic/core";
import { z } from "zod";
import type {
  ConfigChatType,
  ToolResponse,
  ThreadStateType,
} from "../types.ts";
import { previewEmbedding, searchEmbedding } from "../helpers/embeddings.ts";
import type { Message } from "telegraf/types";

export const description = "Search stored chat memory";
export const details = `- searches vector memory for similar snippets\n- dbPath: toolParams.vector_memory.dbPath`;

export const defaultParams = {
  vector_memory: {
    dbPath: "data/memory/default.sqlite",
    dimension: 1536,
  },
};

export class MemorySearchClient extends AIFunctionsProvider {
  protected readonly configChat: ConfigChatType;
  protected readonly thread: ThreadStateType;

  constructor(configChat: ConfigChatType, thread: ThreadStateType) {
    super();
    this.configChat = configChat;
    this.thread = thread;
  }

  @aiFunction({
    name: "memory_search",
    description,
    inputSchema: z.object({
      query: z.string().describe("Search query"),
      limit: z.number().optional().default(3),
    }),
  })
  async memory_search({
    query,
    limit = 3,
  }: {
    query: string;
    limit?: number;
  }): Promise<ToolResponse> {
    const rows = await searchEmbedding({ query, limit, chat: this.configChat });
    const content = rows.map(previewEmbedding).join("\n");
    return { content };
  }

  options_string(str: string) {
    const { query } = JSON.parse(str) as { query: string };
    const text = query || "all";
    return `**Memory search:** \`${text}\``;
  }

  async prompt_append(): Promise<string | undefined> {
    if (!this.configChat.toolParams?.vector_memory?.alwaysSearch) return;
    const last = this.thread.msgs[this.thread.msgs.length - 1] as
      | Message.TextMessage
      | undefined;
    const query = last?.text;
    if (!query) return;
    const res = await this.memory_search({ query, limit: 3 });
    if (!res.content) return;
    return `## Related memory:\n<memory>\n${res.content}\n</memory>`;
  }
}

export function call(configChat: ConfigChatType, thread: ThreadStateType) {
  return new MemorySearchClient(configChat, thread);
}
