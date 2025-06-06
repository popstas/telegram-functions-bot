import * as fs from "fs";
import { aiFunction, AIFunctionsProvider } from "@agentic/core";
import { z } from "zod";
import {
  ConfigChatType,
  ConfigType,
  ObsidianConfigType,
  ThreadStateType,
  ToolResponse,
} from "../types.ts";
import { readConfig } from "../config.ts";
import path from "node:path";
// @ts-ignore
import recursiveReaddir from "recursive-readdir";

type ToolArgsType = {
  file_path: string;
};

export const description =
  "Read the contents of an Obsidian file by files list";
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

  constructor(configChat: ConfigChatType) {
    super();
    this.config = readConfig();
    this.configChat = configChat;
  }

  @aiFunction({
    name: "obsidian_read",
    description,
    inputSchema: z.object({
      file_path: z.string().describe("Path to file in Obsidian project"),
    }),
  })
  obsidian_read(options: ToolArgsType): ToolResponse {
    const root_path = path.resolve(
      this.configChat.toolParams?.obsidian?.root_path || ".",
    );
    const file_paths = this.getFilePath(options);
    const file_paths_abs = file_paths.map((f) =>
      path.resolve(`${root_path}/${f}`),
    );
    const content = file_paths_abs
      .map((f) => {
        try {
          const text = fs.readFileSync(f, "utf8");
          return `\n\n=== ${f.replace(root_path, "")} ===\n` + text;
        } catch (e) {
          return (
            `\n\n=== ${f.replace(root_path, "")} ===\n` + (e as Error).message
          );
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
    const files = (await new Promise((resolve, reject) => {
      recursiveReaddir(root_path, (err: string, files: string[]) => {
        if (err) {
          reject(err);
        } else {
          files = files.map((f) => f.replace(path.resolve(root_path), "")); // relative paths
          const excludeHidden = files
            .filter((f) => !f.startsWith("\\."))
            .filter((f) => !f.startsWith("."));
          resolve(excludeHidden);
        }
      });
    })) as string[];
    return `## Obsidian files:\n${files.map((f) => `- ${f}`).join("\n")}`;
  }
}

export function call(configChat: ConfigChatType, thread: ThreadStateType) {
  return new ObsidianReadClient(configChat);
}
