import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LoggingMessageNotificationSchema, ResourceListChangedNotificationSchema, ListResourcesResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { McpToolConfig, ToolResponse } from './types.ts';
import { log } from './helpers.ts';

// Store active MCP clients by model key
const clients: Record<string, Client> = {};

type McpTool = {
  name: string;
  description: string;
  properties: unknown;
  model: string;
};

type ConnectMcpResult = {
  model: string;
  client: Client | null;
  connected: boolean;
  error?: string | null;
};

/**
 * Initialize MCP servers for each configured model using the MCP SDK.
 * Spawns and connects to external MCP server processes.
 */
export async function init(configs: Record<string, McpToolConfig>): Promise<McpTool[]> {
  log({ 
    msg: `Connecting to ${Object.keys(configs).length} MCP servers...`,
    logLevel: 'debug'
  });

  const connectPromises = Object.entries(configs).map(([model, cfg]) => 
    connectMcp(model, cfg, clients).then(getMcpTools)
  );
  const tools: McpTool[] = (await Promise.all(connectPromises)).flat();
  return tools;
}

async function getMcpTools({ model, client, connected }: { model: string; client: Client | null; connected: boolean }): Promise<McpTool[]> {
  if (!connected || !client) return [];
  const tools: McpTool[] = [];
  
  try {
    // Use the client's listTools method
    const toolsResponse = await client.listTools();
    
    if (toolsResponse?.tools?.length) {
      tools.push(...toolsResponse.tools.map(tool => ({
        name: tool.name,
        description: tool.description || '',
        properties: tool.inputSchema,
        model,
      })));
      
      log({
        msg: `[${model}] Available tools: ${toolsResponse.tools.map(t => t.name).join(', ')}`,
        logLevel: 'debug'
      });
    }
    clients[model] = client;
    return tools;
  } catch (error) {
    log({
      msg: `[${model}] Failed to list tools: ${error instanceof Error ? error.message : String(error)}`,
      logLevel: 'error'
    });
    return [];
  }
}

/**
 * Initialize SSE MCP transport and set up notification handlers
 */
function initSseMcp(serverUrl: string, model: string, client: Client) {
  const transport = new StreamableHTTPClientTransport(new URL(serverUrl), { sessionId: undefined });
  
  // Set up notification handlers (logging and resources)
  client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
    log({ 
      msg: `[${model}] notification: ${notification.params.level} - ${notification.params.data}`,
      logLevel: 'debug'
    });
  });
  
  client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => {
    log({ 
      msg: `[${model}] Resource list changed notification received!`,
      logLevel: 'debug'
    });
    try {
      const resourcesResult = await client.request(
        { method: 'resources/list', params: {} },
        ListResourcesResultSchema
      );
      log({ 
        msg: `[${model}] Available resources count: ${resourcesResult.resources.length}`,
        logLevel: 'debug'
      });
    } catch (error) {
      log({ 
        msg: `[${model}] Failed to list resources after change notification: ${error}`,
        logLevel: 'error'
      });
    }
  });
  
  return transport;
}

/**
 * Connect to an MCP server with the given configuration
 */
async function connectMcp(
  model: string,
  cfg: McpToolConfig,
  clients: Record<string, Client>,
): Promise<ConnectMcpResult> {
  if (clients[model]) return { 
    model, 
    client: clients[model], 
    connected: true,
  };
  
  const client = new Client({ name: model, version: '1.0.0' });
  let transport;
  
  try {
    if (cfg.serverUrl) {
      // Connect via SSE HTTP transport
      transport = initSseMcp(cfg.serverUrl, model, client);
    } else if (cfg.command) {
      transport = new StdioClientTransport({ command: cfg.command, args: cfg.args, env: {
        ...process.env,
        ...cfg.env,
        NODE_OPTIONS: `--unhandled-rejections=warn ${process.env.NODE_OPTIONS || ''}`.trim(),
      }});
    } else {
      throw new Error(`No transport available for MCP ${model}`);
    }
    
    await client.connect(transport);
    return { model, client, connected: true };
  } catch (err) {
    log({msg: `[${model}] Failed to connect to MCP: ${err}`, logLevel: 'error'});
    return { model, client: null, connected: false };
  }
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
    // TODO: Error after this: 400 Invalid parameter: messages with role 'tool' must be a response to a preceeding message with 'tool_calls'
    return { content: `MCP call error: ${message}` };
  }
}
