import { aiFunction, AIFunctionsProvider } from "@agentic/core";
import { z } from "zod";
import { readConfig, writeConfig } from "../config.ts";
import {
  ConfigChatType,
  ConfigType,
  ThreadStateType,
  ToolResponse,
  ChatParamsType,
  ToolParamsType,
} from "../types.ts";

export const description = "Create new agent in config";

export class CreateAgentClient extends AIFunctionsProvider {
  protected readonly config: ConfigType;
  protected readonly configChat: ConfigChatType;
  protected readonly thread: ThreadStateType;

  constructor(configChat: ConfigChatType, thread: ThreadStateType) {
    super();
    this.config = readConfig();
    this.configChat = configChat;
    this.thread = thread;
  }

  @aiFunction({
    name: "create_agent",
    description,
    inputSchema: z.object({
      name: z.string().describe("Human friendly name").optional(),
      description: z
        .string()
        .describe("Tool description for parent agent")
        .optional(),
      agent_name: z
        .string()
        .describe("Unique agent identifier (a-z0-9_)")
        .optional(),
      prompt: z.string().describe("System prompt for the new agent").optional(),
    }),
  })
  async create_agent(args: {
    name?: string;
    description?: string;
    agent_name?: string;
    prompt?: string;
  }): Promise<ToolResponse> {
    const config = readConfig();
    const agent: ConfigChatType = {
      name: args.name || `Agent ${Date.now()}`,
      agent_name:
        args.agent_name ||
        (args.name || "agent").toLowerCase().replace(/[^a-z0-9_]/g, "_"),
      systemMessage: args.prompt || "You are an assistant",
      completionParams: { model: this.configChat.completionParams.model },
      chatParams: { useResponsesApi: false } as ChatParamsType,
      toolParams: {} as ToolParamsType,
    };
    config.chats.push(agent);
    const currentChat = config.chats.find(
      (c) => c.agent_name === this.configChat.agent_name,
    );
    if (currentChat) {
      if (!currentChat.tools) currentChat.tools = [];
      currentChat.tools.push({
        agent_name: agent.agent_name!,
        name: args.name || agent.agent_name!,
        description: args.description,
      });
    }
    writeConfig(undefined, config);
    return { content: `Agent created: ${agent.agent_name}` };
  }
}

export function call(configChat: ConfigChatType, thread: ThreadStateType) {
  return new CreateAgentClient(configChat, thread);
}
