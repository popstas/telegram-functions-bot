import { readdirSync } from "fs";
import { log } from "../helpers.ts";
import { readConfig } from "../config.ts";
import { init as initMcp, callMcp } from "../mcp.ts";
import type { ChatToolType, ConfigChatType } from "../types.ts";

let globalTools: ChatToolType[] = [];
let isInitInProgress = false;

export default async function useTools(): Promise<ChatToolType[]> {
  if (!globalTools.length) await initTools();
  return globalTools;
}

export async function initTools() {
  if (isInitInProgress) {
    log({ msg: "Tools initialization already in progress", logLevel: "info" });
    return;
  }

  isInitInProgress = true;
  try {
    globalTools = [];
    const files = readdirSync("src/tools").filter((file) =>
      file.endsWith(".ts"),
    );

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
        const mcpTools = await initMcp(config.mcpServers);
        for (const tool of mcpTools) {
          const { name, description, properties, model } = tool;

          const chatTool: ChatToolType = {
            name,
            module: {
              description,
              call: (configChat: ConfigChatType) => ({
                configChat,
                mcp: true,
                description,
                properties,
                functions: {
                  get: (toolName: string) => (args: string) =>
                    callMcp(model, toolName, args),
                  toolSpecs: {
                    type: "function" as const,
                    function: {
                      name,
                      description,
                      parameters: properties as Record<string, unknown>,
                    },
                  },
                },
              }),
            },
          };
          globalTools.push(chatTool);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log({ msg: `MCP tools loading error: ${msg}`, logLevel: "error" });
    }

    return globalTools;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log({ msg: `Error initializing tools: ${msg}`, logLevel: "error" });
    return [];
  } finally {
    isInitInProgress = false;
  }
}
