import * as fs from 'fs';
import {aiFunction, AIFunctionsProvider} from '@agentic/core';
import {z} from 'zod';
import {ConfigChatType, ConfigType, ToolResponse} from "../types.ts";
import {readConfig} from "../config.ts";
// @ts-ignore
import recursiveReaddir from 'recursive-readdir';
import path from "node:path";

type ToolArgsType = {
  command: string
}

export class ObsidianReadClient extends AIFunctionsProvider {
  protected readonly config: ConfigType
  protected readonly configChat: ConfigChatType

  constructor(configChat: ConfigChatType) {
    super()

    this.config = readConfig();
    this.configChat = configChat
  }

  @aiFunction({
    name: 'obsidian_read',
    description: 'Read the contents of an Obsidian file',
    inputSchema: z.object({
      command: z
        .string()
        .describe(
          'Path to file in Obsidian project'
        ),
    })
  })
  obsidian_read(options: ToolArgsType): ToolResponse {
    const root_path = path.resolve(this.configChat.options?.obsidian?.root_path || '.');
    const file_paths = options.command.split('\n').map(f => path.resolve(`${root_path}/${f}`))
    const content = file_paths.map(f => `\n\n=== ${f.replace(root_path, '')} ===\n` + fs.readFileSync(f, 'utf8')).join('\n');
    return {content, args: {command: options.command}};
  }
}

export async function prompt_append(configChat: ConfigChatType): Promise<string> {
  // const client = call(configChat)
  const root_path = configChat.options?.obsidian?.root_path || '.';
  const files = await new Promise((resolve, reject) => {
    recursiveReaddir(root_path, (err: string, files: string[]) => {
      if (err) {
        reject(err);
      } else {
        files = files.map(f => f.replace(path.resolve(root_path), '')) // relative paths
        const excludeHidden = files.filter(f => !f.startsWith('\\.')).filter(f => !f.startsWith('.'))
        resolve(excludeHidden);
      }
    });
  }) as string[];
  return `## Obsidian files:\n${files.map(f => `- ${f}`).join('\n')}`;
}

export function call(configChat: ConfigChatType) {
  return new ObsidianReadClient(configChat);
}
