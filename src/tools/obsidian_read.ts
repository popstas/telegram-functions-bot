import * as fs from "fs";
import { readdir } from "fs/promises";
import { aiFunction, AIFunctionsProvider } from "@agentic/core";
import { z } from "zod";
import { ConfigChatType, ConfigType, ObsidianConfigType, ToolResponse } from "../types.ts";
import { readConfig } from "../config.ts";
import path from "node:path";

type ToolArgsType = {
  file_path: string;
};

export const description = "Read the contents of an Obsidian file by files list";
export const details = `- read all obsidian file tree and includes it to prompt
- when answer, read the content from file(s) by path
- root_path: toolParams.obsidian.root_path
- out_file: toolParams.obsidian.out_file`;

export const defaultParams = {
  obsidian: {
    root_path: "/path/to/obsidian",
    out_file: "GPT.md",
  },
} as { obsidian: ObsidianConfigType };

export class ObsidianReadClient extends AIFunctionsProvider {
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
    name: "obsidian_read",
    description,
    inputSchema: z.object({
      file_path: z.string().describe("Path to file in Obsidian project"),
    }),
  })
  obsidian_read(options: ToolArgsType): ToolResponse {
    const root_path = path.resolve(this.configChat.toolParams?.obsidian?.root_path || ".");
    const file_paths = this.getFilePath(options);
    const file_paths_abs = file_paths.map((f) => path.resolve(`${root_path}/${f}`));
    const content = file_paths_abs
      .map((f) => {
        try {
          const text = fs.readFileSync(f, "utf8");
          const relativePath = f.replace(root_path, "").replace(/\\/g, "/");
          return `\n\n=== ${relativePath} ===\n` + text;
        } catch (e) {
          const relativePath = f.replace(root_path, "").replace(/\\/g, "/");
          return `\n\n=== ${relativePath} ===\n` + (e as Error).message;
        }
      })
      .join("\n");
    return { content };
  }

  getFilePath(options: ToolArgsType) {
    return options.file_path.split("\n");
  }

  options_string(str: string) {
    const options = JSON.parse(str) as ToolArgsType;
    if (!options) return str;
    const file_paths = this.getFilePath(options);
    return `**Obsidian read:** \`${file_paths.join(", ").replace(/\\/g, "/")}\``;
  }

  async prompt_append(): Promise<string> {
    const root_path = this.configChat.toolParams?.obsidian?.root_path || ".";
    const allFiles = await readdir(root_path, { recursive: true });
    const files = allFiles
      .filter((f) => !f.startsWith(".")) // exclude hidden files
      .filter((f) => !f.includes("/.")) // exclude hidden directories
      .map((f) => `/${f}`); // add leading slash for consistency
    return `## Obsidian files:\n${files.map((f) => `- ${f}`).join("\n")}`;
  }
}

export function call(configChat: ConfigChatType) {
  return new ObsidianReadClient(configChat);
}
