import {
  ChatToolType,
  ConfigChatType,
  ToolResponse,
  ModuleType,
  ThreadStateType,
} from "../types.ts";
import { readdirSync } from "fs";
import { log } from "../helpers.ts";
import { OpenAI } from "openai";

let globalTools: ChatToolType[] = [];

export default async function useTools(): Promise<ChatToolType[]> {
  if (!globalTools.length) await initTools();
  return globalTools;
}

import { readConfig } from "../config.ts";
import { init as initMcp, callMcp } from "../mcp.ts";

export async function initTools() {
  globalTools = [];
  const files = readdirSync("src/tools").filter((file) => file.endsWith(".ts"));

  for (const file of files) {
    const name = file.replace(".ts", "");
    const module = await import(`../tools/${name}`);
    if (typeof module.call !== "function") {
      log({ msg: `Function ${name} has no call() method`, logLevel: "warn" });
      continue;
    }
    globalTools.push({ name, module });
  }

  // --- Add MCP tools ---
  try {
    const config = readConfig();
    if (config.mcpServers) {
      // init returns array of {type, function: {name, description, properties}}
      const mcpTools = await initMcp(config.mcpServers);
      for (const tool of mcpTools) {
        const { name, description, properties, model } = tool;
        const mcp = {
          mcp: true,
          description,
          properties,
          functions: {
            get(name: string): (args: string) => Promise<ToolResponse> {
              return (args: string) => {
                return callMcp(model, name, args);
              };
            },
            // openai api format
            toolSpecs: {
              type: "function",
              function: {
                name,
                description,
                parameters: properties,
              },
            } as OpenAI.Chat.Completions.ChatCompletionTool,
          },
        } as ModuleType;
        function newMcp(
          configChat: ConfigChatType,
          thread: ThreadStateType,
        ): ModuleType {
          const threadMcp = {
            ...mcp,
            thread,
            configChat,
          };
          return threadMcp;
        }

        const chatTool = {
          name,
          module: {
            description,
            call: (configChat: ConfigChatType, thread: ThreadStateType) => {
              return newMcp(configChat, thread);
            },
          },
        } as ChatToolType;
        globalTools.push(chatTool);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log({ msg: `MCP tools loading error: ${msg}` });
  }

  return globalTools;
}
