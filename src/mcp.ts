import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio';
import type { McpToolConfig, ToolResponse } from './types.ts';
import {log} from "./helpers.ts";

// Store active MCP clients by model key
const clients: Record<string, Client> = {};

/**
 * Initialize MCP servers for each configured model using the MCP SDK.
 * Spawns and connects to external MCP server processes.
 */
export async function init(configs: Record<string, McpToolConfig>) {
  const tools = [];
  // Prepare connect promises for all models
  const connectPromises = Object.entries(configs).map(async ([model, cfg]) => {
    if (clients[model]) return { model, client: clients[model], connected: true };
    const client = new Client({ name: model, version: '1.0.0' });
    try {
      const transport = new StdioClientTransport({ command: cfg.command, args: cfg.args, env: cfg.env });
      log({msg: `Connecting to MCP ${model}...`})
      await client.connect(transport);
      return { model, client, connected: true };
    } catch (err) {
      log({msg: `Failed to connect to MCP ${model}: ${err}`});
      return { model, client: null, connected: false };
    }
  });

  // Wait for all connect attempts to finish
  const connectResults = await Promise.all(connectPromises);

  // For each successfully connected client, list tools
  for (const result of connectResults) {
    if (!result.connected || !result.client) continue;
    const { model, client } = result;
    const toolsResult = await client.listTools();
    tools.push(...toolsResult.tools.map((tool: unknown) => {
      const t = tool as { name: string; description: string; inputSchema: unknown };
      return {
        name: t.name,
        description: t.description,
        properties: t.inputSchema,
        model,
      };
    }));
    log({msg: `MCP ${model} loaded, tools: ${toolsResult.tools.map(tool => tool.name).join(', ')}`});
    clients[model] = client;
  }
  return tools;
}

/**
 * Call a tool on the MCP server for a given model.
 */
export async function callMcp(
  model: string,
  toolName: string,
  args: string,
): Promise<ToolResponse> {
  const client = clients[model];
  if (!client) {
    return { content: `MCP client not initialized: ${model}` };
  }
  try {
    const result = await client.callTool({ name: toolName, arguments: JSON.parse(args) });
    return { content: typeof result.content === 'string' ? result.content : JSON.stringify(result.content) };
  } catch (err: unknown) {
    let message;
    if (typeof err === 'object' && err !== null && 'message' in err) {
      message = (err as { message?: string }).message || '';
    } else {
      message = String(err);
    }
    return { content: `MCP call error: ${message}` };
  }
}
