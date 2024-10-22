import * as fs from 'fs';
import {aiFunction, AIFunctionsProvider} from '@agentic/core';
import { z } from 'zod';
import {ConfigChatType, ConfigType, ToolResponse} from "../types.ts";
import {readConfig} from "../config.ts";

type ToolArgsType = {
  command: string
}

export class ObsidianWriteClient extends AIFunctionsProvider {
  protected readonly config: ConfigType
  protected readonly configChat: ConfigChatType

  constructor(configChat: ConfigChatType) {
    super()

    this.config = readConfig();
    this.configChat = configChat
  }

  @aiFunction({
    name: 'obsidian_write',
    description: 'Append text to a markdown file specified by out_file',
    inputSchema: z.object({
      command: z
        .string()
        .describe(
          'Text to append to the markdown file'
        ),
    })
  })
  obsidian_write(options: ToolArgsType): ToolResponse {
    const root_path = this.configChat.options?.obsidian?.root_path;
    if (!root_path) {
      return {content: 'No root_path in config'} as ToolResponse;
    }
    const out_file = this.configChat.options?.obsidian?.out_file || 'gpt.md';
    const out_path = `${root_path}/${out_file}`;
    fs.appendFileSync(out_path, options.command + '\n');
    return {content: `Appended to ${out_file}`} as ToolResponse;
  }
}

export function call(configChat: ConfigChatType) {
  return new ObsidianWriteClient(configChat);
}
