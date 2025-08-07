import { aiFunction, AIFunctionsProvider } from "@agentic/core";
import { z } from "zod";
import { ConfigChatType, ThreadStateType } from "../types.ts";
import { forgetHistory } from "../helpers/history.ts";
import { log } from "../helpers.ts";

// No arguments needed for forget tool

export const description = "Clear the conversation history and start fresh";

export class ForgetClient extends AIFunctionsProvider {
  protected readonly configChat: ConfigChatType;
  protected readonly thread: ThreadStateType;

  constructor(configChat: ConfigChatType, thread: ThreadStateType) {
    super();
    this.configChat = configChat;
    this.thread = thread;
  }

  @aiFunction({
    name: "forget",
    description,
    inputSchema: z.object({
      message: z.string().optional().describe("Optional final message to send to the user"),
    }),
  })
  async forget({ message }: { message?: string }) {
    try {
      forgetHistory(this.thread.id);
      log({
        msg: `Forgot history for chat ${this.thread.id}`,
        logLevel: "info",
        chatId: this.thread.id,
        role: "system",
      });
      return { content: message || "Forgot history" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log({
        msg: `Failed to forget history: ${errorMessage}`,
        logLevel: "error",
        chatId: this.thread.id,
        role: "system",
      });
      return { content: `Failed to forget history: ${errorMessage}` };
    }
  }

  options_string() {
    return "`Clear conversation history`";
  }
}

export function call(configChat: ConfigChatType, thread: ThreadStateType) {
  return new ForgetClient(configChat, thread);
}
