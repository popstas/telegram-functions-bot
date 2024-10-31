import {
  aiFunction,
  AIFunctionsProvider,
} from '@agentic/core'
import {z} from 'zod'
import {readConfig} from '../config.ts'
import {ConfigType, ToolResponse} from "../types.ts";

type ToolArgsType = {
  startOffDate: string,
  currentDate: string
}

let client: NextOffdayClient | undefined

export const description = 'Useful for running JavaScript code in sandbox. Input is a string of JavaScript code, output is the result of the code.'
export const details = ``

export class NextOffdayClient extends AIFunctionsProvider {
  protected readonly config: ConfigType

  constructor() {
    super()

    this.config = readConfig();
  }

  @aiFunction({
    name: 'get_next_offday',
    description,
    inputSchema: z.object({
      startOffDate: z
        .string()
        .describe(
          'Start off date, YYYY-MM-DD'
        ),
      currentDate: z
        .string()
        .describe(
          'Current date, YYYY-MM-DD'
        ),
    })
  })

  async get_next_offday({startOffDate, currentDate}: ToolArgsType) {
    const startDate = new Date(startOffDate);
    const current = new Date(currentDate);
    // @ts-ignore
    const diffTime = Math.abs(current - startDate);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const cycleLength = 4;
    const daysSinceLastOff = diffDays % cycleLength;
    const nextOffInDays = (cycleLength - daysSinceLastOff) % cycleLength;
    const nextOffDate = new Date(current);
    nextOffDate.setDate(current.getDate() + nextOffInDays);
    const content = nextOffDate.toISOString().split('T')[0];

    return {content} as ToolResponse
  }
}

export function call() {
  if (!client) client = new NextOffdayClient();
  return client
}
