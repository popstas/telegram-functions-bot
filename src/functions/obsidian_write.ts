import * as fs from 'fs';
import {aiFunction, AIFunctionsProvider} from '@agentic/core';
import { z } from 'zod';
import {ConfigChatType, ConfigType, ToolResponse} from "../types.ts";
import {readConfig} from "../config.ts";
import * as path from 'path';

type ToolArgsType = {
  command: string
  // file_path: string
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
    description: 'Append "command" text to file',
    inputSchema: z.object({
      // file_path: z
      //   .string()
      //   // .optional()
      //   .describe(
      //     'File to append, path from Obsidian project'
      //   ),
      command: z
        .string()
        .describe(
          'Text to append to the markdown file'
        ),
    }),
    strict: true,
  })
  obsidian_write(options: ToolArgsType): ToolResponse {
    const root_path = this.configChat.options?.obsidian?.root_path;
    const args = {command: options.command};
    if (!root_path) {
      return {content: 'No root_path in config', args} as ToolResponse;
    }

    let out_file = this.configChat.options?.obsidian?.out_file || 'gpt.md';
    if (!fs.existsSync(path.join(root_path, out_file))) {
      out_file = 'gpt.md'
    }

    const out_path = `${root_path}/${out_file}`;
    fs.appendFileSync(out_path, options.command + '\n');
    return {content: `Appended to ${out_file}`, args} as ToolResponse;
  }
}

export function call(configChat: ConfigChatType) {
  return new ObsidianWriteClient(configChat);
}
