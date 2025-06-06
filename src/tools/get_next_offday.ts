import { aiFunction, AIFunctionsProvider } from "@agentic/core";
import { z } from "zod";
import { readConfig } from "../config.ts";
import { ConfigType, ToolResponse } from "../types.ts";

type ToolArgsType = {
  startOffDate: string;
  currentDate: string;
};

export const description = "Get the next offday from the start off date";
export const details = `- Calculate the next offday from the start off date
- cycle length is 4 days
- startOffDate: YYYY-MM-DD
- currentDate: YYYY-MM-DD`;

export class NextOffdayClient extends AIFunctionsProvider {
  protected readonly config: ConfigType;
  protected readonly details: string;

  constructor() {
    super();
    this.config = readConfig();
    this.details = details;
  }

  @aiFunction({
    name: "get_next_offday",
    description,
    inputSchema: z.object({
      startOffDate: z.string().describe("Start off date, YYYY-MM-DD"),
      currentDate: z.string().describe("Current date, YYYY-MM-DD"),
    }),
  })
  async get_next_offday({ startOffDate, currentDate }: ToolArgsType) {
    const startDate = new Date(startOffDate);
    const current = new Date(currentDate);
    const diffTime = Math.abs(current.getTime() - startDate.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const cycleLength = 4;
    const daysSinceLastOff = diffDays % cycleLength;
    const nextOffInDays = (cycleLength - daysSinceLastOff) % cycleLength;
    const nextOffDate = new Date(current);
    nextOffDate.setDate(current.getDate() + nextOffInDays);
    const content = nextOffDate.toISOString().split("T")[0];

    return { content } as ToolResponse;
  }

  options_string(str: string) {
    const { startOffDate, currentDate } = JSON.parse(str) as ToolArgsType;
    if (!startOffDate || !currentDate) return str;
    return `\`get_next_offday(${startOffDate}, ${currentDate})\``;
  }
}

export function call() {
  return new NextOffdayClient();
}
