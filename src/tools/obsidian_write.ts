import * as fs from "fs";
import { aiFunction, AIFunctionsProvider } from "@agentic/core";
import { z } from "zod";
import { ConfigChatType, ConfigType, ObsidianConfigType, ToolResponse } from "../types.ts";
import { readConfig } from "../config.ts";
import * as path from "path";

type ToolArgsType = {
  markdown: string;
  // file_path: string
};

export const description = "Append markdown text to file";
export const details = `- Just append markdown text to file
- default: gpt.md`;

export const defaultParams = {
  obsidian: {
    root_path: "/path/to/obsidian",
    out_file: "gpt.md",
  },
} as { obsidian: ObsidianConfigType };

export class ObsidianWriteClient extends AIFunctionsProvider {
  protected readonly config: ConfigType;
  protected readonly configChat: ConfigChatType;
  protected readonly details: string;

  constructor(configChat: ConfigChatType) {
    super();
    this.config = readConfig();
    this.configChat = configChat;
    this.details = details;
  }

  @aiFunction({
    name: "obsidian_write",
    description,
    inputSchema: z.object({
      // file_path: z
      //   .string()
      //   // .optional()
      //   .describe(
      //     'File to append, path from Obsidian project'
      //   ),
      markdown: z.string().describe("Text to append to the markdown file"),
    }),
    strict: true,
  })
  obsidian_write(options: ToolArgsType): ToolResponse {
    const root_path = this.configChat.toolParams?.obsidian?.root_path;
    if (!root_path) {
      return { content: "No root_path in config" } as ToolResponse;
    }

    let out_file = this.configChat.toolParams?.obsidian?.out_file || "gpt.md";
    if (!fs.existsSync(path.join(root_path, out_file))) {
      out_file = "gpt.md";
    }

    const out_path = `${root_path}/${out_file}`;
    fs.appendFileSync(out_path, options.markdown + "\n");
    return { content: `Appended to ${out_file}` } as ToolResponse;
  }

  options_string(str: string) {
    const { markdown } = JSON.parse(str) as ToolArgsType;
    if (!markdown) return str;
    return `**Write to Obsidian:**\`\n\`\`\`md\n${markdown.replace(/```/g, "\\```")}\n\`\`\``;
  }
}

export function call(configChat: ConfigChatType) {
  return new ObsidianWriteClient(configChat);
}
