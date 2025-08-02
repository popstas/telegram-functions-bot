import { aiFunction, AIFunctionsProvider } from "@agentic/core";
import { z } from "zod";
import type {
  ConfigChatType,
  ToolResponse,
  ThreadStateType,
} from "../types.ts";
import { deleteEmbedding } from "../helpers/embeddings.ts";

export const description = "Delete stored chat memory";
export const details = `- deletes vector memory for similar snippets\n- dbPath: toolParams.vector_memory.dbPath`;

export const defaultParams = {
  vector_memory: {
    dbPath: "data/memory/default.sqlite",
    dimension: 1536,
  },
};

export class MemoryDeleteClient extends AIFunctionsProvider {
  protected readonly configChat: ConfigChatType;
  protected readonly thread: ThreadStateType;

  constructor(configChat: ConfigChatType, thread: ThreadStateType) {
    super();
    this.configChat = configChat;
    this.thread = thread;
  }

  @aiFunction({
    name: "memory_delete",
    description,
    inputSchema: z.object({
      query: z.string().describe("Delete query"),
      limit: z.number().optional().default(3),
    }),
  })
  async memory_delete({
    query,
    limit = 3,
  }: {
    query: string;
    limit?: number;
  }): Promise<ToolResponse> {
    const rows = await deleteEmbedding({ query, limit, chat: this.configChat });
    const content = rows.map((r) => `${r.date} ${r.text}`).join("\n");
    return { content };
  }

  options_string(str: string) {
    const { query } = JSON.parse(str) as { query: string };
    if (!query) return str;
    return `**Memory delete:** \`${query}\``;
  }
}

export function call(configChat: ConfigChatType, thread: ThreadStateType) {
  return new MemoryDeleteClient(configChat, thread);
}
