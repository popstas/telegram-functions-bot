import { aiFunction, AIFunctionsProvider } from "@agentic/core";
import { z } from "zod";
import type { ConfigChatType, ToolResponse, ThreadStateType } from "../types.ts";
import { rememberSave } from "../helpers/memory.ts";
import type { Message } from "telegraf/types";

export const description = "Add/store text into vector memory";
export const details = `- stores text to vector memory\n- dbPath: toolParams.vector_memory.dbPath`;

export const defaultParams = {
  vector_memory: {
    dbPath: "data/memory/default.sqlite",
    dimension: 1536,
  },
};

export class MemoryAddClient extends AIFunctionsProvider {
  protected readonly configChat: ConfigChatType;
  protected readonly thread: ThreadStateType;

  constructor(configChat: ConfigChatType, thread: ThreadStateType) {
    super();
    this.configChat = configChat;
    this.thread = thread;
  }

  @aiFunction({
    name: "memory_add",
    description,
    inputSchema: z.object({
      text: z.string().min(1).describe("Text to store in memory"),
    }),
  })
  async memory_add({ text }: { text: string }): Promise<ToolResponse> {
    const lastMsg = this.thread.msgs.at(-1) as Message.TextMessage | undefined;
    const content = await rememberSave({ text, msg: lastMsg, chat: this.configChat });
    return { content };
  }

  options_string(str: string) {
    const { text } = JSON.parse(str) as { text: string };
    const preview = text?.slice(0, 48) || "";
    return `**Memory add:** \`${preview}\``;
  }
}

export function call(configChat: ConfigChatType, thread: ThreadStateType) {
  return new MemoryAddClient(configChat, thread);
}
