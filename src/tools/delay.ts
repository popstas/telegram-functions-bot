import { aiFunction, AIFunctionsProvider } from "@agentic/core";
import { z } from "zod";
import type { ConfigChatType, ThreadStateType } from "../types.ts";

export const description = "Pause execution for a specified number of seconds before continuing.";

type ToolArgsType = {
  seconds: number;
};

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
        .min(0, "seconds must be a non-negative number")
        .max(3600, "seconds must not exceed 3600")
        .describe("Number of seconds to pause before responding"),
    }),
  })
  async delay({ seconds }: ToolArgsType) {
    const milliseconds = Math.round(seconds * 1000);

    if (milliseconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, milliseconds));
    }

    const secondsLabel = seconds === 1 ? "second" : "seconds";
    return { content: `Waited ${seconds} ${secondsLabel}.` };
  }

  options_string(str: string) {
    try {
      const { seconds } = JSON.parse(str) as Partial<ToolArgsType>;
      if (typeof seconds === "number") {
        const secondsLabel = seconds === 1 ? "second" : "seconds";
        return `**Delay:** wait ${seconds} ${secondsLabel}`;
      }
    } catch {
      // ignore parsing errors and return original string
    }
    return str;
  }
}

export function call(configChat: ConfigChatType, thread: ThreadStateType) {
  return new DelayClient(configChat, thread);
}
