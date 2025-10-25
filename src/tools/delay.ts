import { aiFunction, AIFunctionsProvider } from "@agentic/core";
import { z } from "zod";
import type { ConfigChatType, ThreadStateType } from "../types.ts";

export const description = "Pause execution for a specified number of seconds before continuing.";

const inputSchema = z.object({
  seconds: z
    .number()
    .min(0, "seconds must be a non-negative number")
    .max(3600, "seconds must not exceed 3600")
    .describe("Number of seconds to pause before responding")
    .default(5),
  reason: z
    .string()
    .min(1, "reason must be provided")
    .describe("Explanation for why a delay is required"),
});

type ToolArgsType = z.input<typeof inputSchema>;

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
    inputSchema,
  })
  async delay({ seconds = 5, reason }: ToolArgsType) {
    const milliseconds = Math.round(seconds * 1000);

    if (milliseconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, milliseconds));
    }

    const secondsLabel = seconds === 1 ? "second" : "seconds";
    return { content: `Waited ${seconds} ${secondsLabel}. Reason: ${reason}` };
  }

  options_string(str: string) {
    try {
      const { seconds, reason } = JSON.parse(str) as Partial<ToolArgsType>;
      const resolvedSeconds =
        typeof seconds === "number" ? seconds : seconds === undefined ? 5 : undefined;
      if (typeof resolvedSeconds === "number") {
        const secondsLabel = resolvedSeconds === 1 ? "second" : "seconds";
        const reasonLabel = typeof reason === "string" && reason.length > 0 ? ` — ${reason}` : "";
        return `**Delay:** wait ${resolvedSeconds} ${secondsLabel}${reasonLabel}`;
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
