import { readdirSync } from "fs";
import { log } from "../helpers.ts";
import { readConfig } from "../config.ts";
import { init as initMcp, callMcp, initChatMcp, disconnectChatMcp } from "../mcp.ts";
import { sendTelegramMessage } from "../telegram/send.ts";
import type { ChatToolType, ConfigChatType } from "../types.ts";

let globalTools: ChatToolType[] = [];
let isInitInProgress = false;
let toolsInitPromise: Promise<ChatToolType[]> | null = null;

export default async function useTools(): Promise<ChatToolType[]> {
  if (isInitInProgress && toolsInitPromise) {
    await toolsInitPromise;
  } else if (!globalTools.length) {
    await initTools();
  }
  return globalTools;
}

export async function initTools(): Promise<ChatToolType[]> {
  if (isInitInProgress) {
    if (toolsInitPromise) await toolsInitPromise;
    return globalTools;
  }

  isInitInProgress = true;
  toolsInitPromise = (async () => {
    try {
      globalTools = [];
      const files = readdirSync("src/tools").filter((file) => file.endsWith(".ts"));

      for (const file of files) {
        const name = file.replace(".ts", "");
        const module = await import(`../tools/${name}`);
        if (typeof module.call !== "function") {
          log({
            msg: `Function ${name} has no call() method`,
            logLevel: "warn",
          });
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
                    get: (toolName: string) => (args: string) => callMcp(model, toolName, args),
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
      toolsInitPromise = null;
    }
  })();

  return toolsInitPromise;
}

// --- Per-chat MCP tools ---

type ChatMcpCacheEntry = {
  tools: ChatToolType[];
  configHash: string;
  initPromise?: Promise<ChatToolType[]>;
};

const chatMcpState: Record<number, ChatMcpCacheEntry> = {};

function mcpToolToChatTool(
  name: string,
  description: string,
  properties: unknown,
  model: string,
): ChatToolType {
  return {
    name,
    module: {
      description,
      call: (configChat: ConfigChatType) => ({
        configChat,
        mcp: true,
        description,
        properties,
        functions: {
          get: (toolName: string) => (args: string) => callMcp(model, toolName, args),
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
}

export async function useChatMcpTools(
  chatId: number,
  chatConfig: ConfigChatType,
): Promise<ChatToolType[]> {
  const servers = chatConfig.mcpServers;
  if (!servers || Object.keys(servers).length === 0) {
    // Cleanup if previously had tools
    if (chatMcpState[chatId]) {
      await disconnectChatMcp(chatId);
      delete chatMcpState[chatId];
    }
    return [];
  }

  const configHash = JSON.stringify(servers);
  const cached = chatMcpState[chatId];

  // Return cached if config hasn't changed
  if (cached && cached.configHash === configHash) {
    if (cached.initPromise) {
      return cached.initPromise;
    }
    return cached.tools;
  }

  // Config changed or first init — disconnect old, init new
  if (cached) {
    await disconnectChatMcp(chatId);
  }

  const onAuthUrl = (url: URL) => {
    sendTelegramMessage(
      chatId,
      `🔐 MCP OAuth authorization required. Visit this URL to authorize:\n${url.toString()}`,
    );
  };

  const initPromise = (async (): Promise<ChatToolType[]> => {
    try {
      const mcpTools = await initChatMcp(chatId, servers, onAuthUrl);
      const tools: ChatToolType[] = mcpTools.map((tool) =>
        mcpToolToChatTool(tool.name, tool.description, tool.properties, tool.model),
      );
      chatMcpState[chatId] = { tools, configHash };
      return tools;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log({ msg: `Chat ${chatId} MCP tools loading error: ${msg}`, logLevel: "error" });
      chatMcpState[chatId] = { tools: [], configHash };
      return [];
    }
  })();

  chatMcpState[chatId] = { tools: [], configHash, initPromise };
  return initPromise;
}

export async function cleanupChatMcpTools(chatId: number): Promise<void> {
  if (chatMcpState[chatId]) {
    await disconnectChatMcp(chatId);
    delete chatMcpState[chatId];
  }
}

export const __testChatMcp = {
  getState() {
    return chatMcpState;
  },
  clearState() {
    for (const key of Object.keys(chatMcpState)) {
      delete chatMcpState[Number(key)];
    }
  },
};
