import { aiFunction, AIFunctionsProvider } from "@agentic/core";
import { z } from "zod";
import { ConfigChatType, ThreadStateType } from "../types.ts";
import { log } from "../helpers.ts";

export const description =
  "Wait for a specified number of seconds, then return the current datetime";

export class DelayClient extends AIFunctionsProvider {
  protected readonly configChat: ConfigChatType;
  protected readonly thread: ThreadStateType;

  constructor(configChat: ConfigChatType, thread: ThreadStateType) {
    super();
    this.configChat = configChat;
    this.thread = thread;
  }

  @aiFunction({
    name: "delay",
    description,
    inputSchema: z.object({
      seconds: z
        .number()
        .min(1)
        .max(85)
        .default(5)
        .describe("Number of seconds to wait (default: 5, max: 85)"),
      reason: z.string().describe("Reason for the delay"),
    }),
  })
  async delay({ seconds = 5 }: { seconds?: number; reason: string }) {
    try {
      // Ensure seconds is within bounds
      const waitTime = Math.min(Math.max(seconds, 1), 85);

      // Wait for specified seconds
      await new Promise((resolve) => setTimeout(resolve, waitTime * 1000));

      const currentDateTime = new Date().toISOString();

      return {
        content: `Waited ${waitTime} seconds. Current datetime: ${currentDateTime}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { content: `Failed to delay: ${errorMessage}` };
    }
  }

  options_string() {
    return "`Wait for specified seconds and return current datetime`";
  }
}

export function call(configChat: ConfigChatType, thread: ThreadStateType) {
  return new DelayClient(configChat, thread);
}
