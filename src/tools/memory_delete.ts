import { aiFunction, AIFunctionsProvider } from "@agentic/core";
import { z } from "zod";
import type {
  ConfigChatType,
  ToolResponse,
  ThreadStateType,
} from "../types.ts";
import { deleteEmbedding } from "../helpers/embeddings.ts";
import { sendTelegramMessage } from "../telegram/send.ts";

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
      limit: z.number().describe("Limit, set to 1 if not specified").optional().default(1),
    }),
  })
  async memory_delete({
    query,
    limit = 1,
  }: {
    query: string;
    limit?: number;
  }): Promise<ToolResponse> {
    const rows = await deleteEmbedding({ query, limit, chat: this.configChat });
    const content = rows.map((r) => `${r.date} ${r.text}`).join("\n");
    await sendTelegramMessage(
      this.thread.id,
      `Удалено записей: ${rows.length}`,
      undefined,
      undefined,
      this.configChat,
    );
    return { content };
  }

  options_string(str: string) {
    const { query } = JSON.parse(str) as { query: string };
    const text = query || "all";
    return `**Memory delete:** \`${text}\``;
  }
}

export function call(configChat: ConfigChatType, thread: ThreadStateType) {
  return new MemoryDeleteClient(configChat, thread);
}
