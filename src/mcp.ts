import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  LoggingMessageNotificationSchema,
  ResourceListChangedNotificationSchema,
  ListResourcesResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpToolConfig, ToolResponse } from "./types.ts";
import { log } from "./helpers.ts";

// Store active MCP clients by model key
const clients: Record<string, Client> = {};

// HTTP transport state for session management and failover reconnect.
// Session: we pass sessionId when creating transport; on 404 (session invalid) we reconnect without it.
// SSE resumption (Last-Event-ID) is handled inside StreamableHTTPClientTransport.
const httpTransports: Record<string, StreamableHTTPClientTransport> = {};
const mcpConfigs: Record<string, McpToolConfig> = {};
const sessionIds: Record<string, string | undefined> = {};

export const __test = {
  /** Reset cached clients and HTTP state - used in tests */
  resetClients() {
    for (const key of Object.keys(clients)) {
      delete clients[key];
    }
    for (const key of Object.keys(httpTransports)) {
      delete httpTransports[key];
    }
    for (const key of Object.keys(mcpConfigs)) {
      delete mcpConfigs[key];
    }
    for (const key of Object.keys(sessionIds)) {
      delete sessionIds[key];
    }
    reconnectMcpImpl = connectMcp;
  },
  /** Manually set a client for a model - used in tests */
  setClient(model: string, client: Client) {
    clients[model] = client;
  },
  /** Set MCP config for a model - used in tests for 404 reconnect path */
  setMcpConfig(model: string, config: McpToolConfig) {
    mcpConfigs[model] = config;
  },
  /** Override reconnect implementation - used in tests for 404 reconnect path */
  setReconnectImpl(
    fn: (
      model: string,
      cfg: McpToolConfig,
      clients: Record<string, Client>,
    ) => Promise<ConnectMcpResult>,
  ) {
    reconnectMcpImpl = fn;
  },
  /** Reset reconnect implementation to default */
  resetReconnectImpl() {
    reconnectMcpImpl = connectMcp;
  },
};

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

/** True if the error indicates the server session is invalid (404 or "Session not found" etc.). */
function isSessionInvalidError(err: unknown): boolean {
  if (err instanceof StreamableHTTPError && err.code === 404) return true;
  const msg =
    typeof err === "object" && err !== null && "message" in err
      ? String((err as { message?: unknown }).message)
      : String(err);
  return /session not found|missing session id/i.test(msg);
}

/** True if the error indicates the server requires a session ID on first request (non-spec). */
function isMissingSessionIdError(err: unknown): boolean {
  const msg =
    typeof err === "object" && err !== null && "message" in err
      ? String((err as { message?: unknown }).message)
      : String(err);
  return /missing session id/i.test(msg);
}

/**
 * Initialize MCP servers for each configured model using the MCP SDK.
 * Spawns and connects to external MCP server processes.
 */
export async function init(configs: Record<string, McpToolConfig>): Promise<McpTool[]> {
  log({
    msg: `Connecting to ${Object.keys(configs).length} MCP servers...`,
    logLevel: "debug",
  });
  const startTime = Date.now();
  const times: Record<string, number> = {};

  const connectPromises = Object.entries(configs).map(([model, cfg]) => {
    const modelStart = Date.now();
    return connectMcp(model, cfg, clients)
      .then((res) => getMcpTools(res))
      .finally(() => {
        times[model] = (Date.now() - modelStart) / 1000;
      });
  });

  const tools: McpTool[] = (await Promise.all(connectPromises)).flat();
  const total = (Date.now() - startTime) / 1000;
  const detail = Object.entries(times)
    .map(([model, t]) => `${model}: ${t.toFixed(1)} sec`)
    .join(", ");
  log({ msg: `MCP loaded for ${total.toFixed(1)} sec. ${detail}` });
  return tools;
}

async function getMcpTools({
  model,
  client,
  connected,
}: {
  model: string;
  client: Client | null;
  connected: boolean;
}): Promise<McpTool[]> {
  if (!connected || !client) return [];
  const tools: McpTool[] = [];

  const doListTools = (c: Client) => c.listTools();
  try {
    const toolsResponse = await doListTools(client);

    if (toolsResponse?.tools?.length) {
      tools.push(
        ...toolsResponse.tools.map((tool) => ({
          name: tool.name,
          description: tool.description || "",
          properties: tool.inputSchema,
          model,
        })),
      );

      log({
        msg: `[${model}] Available tools: ${toolsResponse.tools.map((t) => t.name).join(", ")}`,
        logLevel: "debug",
      });
    }
    clients[model] = client;
    return tools;
  } catch (error) {
    const hasHttpState = httpTransports[model] ?? mcpConfigs[model];
    if (isSessionInvalidError(error) && hasHttpState) {
      const reconnected = await reconnectMcp(model);
      if (reconnected.connected && reconnected.client) {
        try {
          const toolsResponse = await doListTools(reconnected.client);
          if (toolsResponse?.tools?.length) {
            tools.push(
              ...toolsResponse.tools.map((tool) => ({
                name: tool.name,
                description: tool.description || "",
                properties: tool.inputSchema,
                model,
              })),
            );
            log({
              msg: `[${model}] Available tools: ${toolsResponse.tools.map((t) => t.name).join(", ")}`,
              logLevel: "debug",
            });
          }
          clients[model] = reconnected.client;
          return tools;
        } catch (retryErr) {
          log({
            msg: `[${model}] Failed to list tools after reconnect: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
            logLevel: "error",
          });
          return [];
        }
      }
    }
    log({
      msg: `[${model}] Failed to list tools: ${error instanceof Error ? error.message : String(error)}`,
      logLevel: "error",
    });
    return [];
  }
}

/**
 * Initialize streamable HTTP MCP transport and set up notification handlers.
 * Per MCP spec: first connect uses no session ID; server assigns session at initialization
 * and returns it in Mcp-Session-Id header; we send it only on subsequent requests.
 */
function initStreamableHttpMcp(url: string, model: string, client: Client, sessionId?: string) {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    sessionId,
  });

  // Set up notification handlers (logging and resources)
  client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
    log({
      msg: `[${model}] notification: ${notification.params.level} - ${notification.params.data}`,
      logLevel: "debug",
    });
  });

  client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => {
    log({
      msg: `[${model}] Resource list changed notification received!`,
      logLevel: "debug",
    });
    try {
      const resourcesResult = await client.request(
        { method: "resources/list", params: {} },
        ListResourcesResultSchema,
      );
      log({
        msg: `[${model}] Available resources count: ${resourcesResult.resources.length}`,
        logLevel: "debug",
      });
    } catch (error) {
      log({
        msg: `[${model}] Failed to list resources after change notification: ${error}`,
        logLevel: "error",
      });
    }
  });

  return transport;
}

/**
 * Connect to an MCP server with the given configuration
 */
export async function connectMcp(
  model: string,
  cfg: McpToolConfig,
  clients: Record<string, Client>,
): Promise<ConnectMcpResult> {
  if (clients[model])
    return {
      model,
      client: clients[model],
      connected: true,
    };

  let client = new Client({ name: model, version: "1.0.0" });
  let transport: StreamableHTTPClientTransport | StdioClientTransport | undefined;

  try {
    const httpUrl = cfg.url ?? cfg.serverUrl;
    if (cfg.serverUrl && !cfg.url) {
      log({
        msg: `[${model}] serverUrl is deprecated, use url instead`,
        logLevel: "warn",
      });
    }
    if (httpUrl) {
      // Per MCP spec: first connect with no session ID; server assigns session at init.
      // Fallback: if server returns "Missing session ID" (e.g. requires it on GET/SSE),
      // retry once with a client-generated session ID.
      let lastErr: unknown = undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          transport = initStreamableHttpMcp(httpUrl, model, client, sessionIds[model]);
          await client.connect(transport);
          lastErr = undefined;
          break;
        } catch (err) {
          lastErr = err;
          if (
            attempt === 0 &&
            isMissingSessionIdError(err) &&
            sessionIds[model] === undefined
          ) {
            sessionIds[model] = randomUUID();
            client = new Client({ name: model, version: "1.0.0" });
            log({
              msg: `[${model}] Retrying connect with client-generated session ID`,
              logLevel: "debug",
            });
            continue;
          }
          throw err;
        }
      }
      if (lastErr !== undefined) throw lastErr;
    } else if (cfg.command) {
      transport = new StdioClientTransport({
        command: cfg.command,
        args: cfg.args,
        env: {
          ...process.env,
          ...cfg.env,
          NODE_OPTIONS: `--unhandled-rejections=warn ${process.env.NODE_OPTIONS || ""}`.trim(),
        },
      });
      await client.connect(transport);
    } else {
      throw new Error(`No transport available for MCP ${model}`);
    }

    if (httpUrl && transport) {
      const httpTransport = transport as StreamableHTTPClientTransport;
      httpTransports[model] = httpTransport;
      mcpConfigs[model] = cfg;
      sessionIds[model] = httpTransport.sessionId;
    }
    return { model, client, connected: true };
  } catch (err) {
    log({
      msg: `[${model}] Failed to connect to MCP: ${err}`,
      logLevel: "error",
    });
    return { model, client: null, connected: false };
  }
}

/**
 * Reconnect to an MCP server after session invalid (404 or "Session not found").
 * Closes existing HTTP transport, clears client and session, then connects again without session id.
 */
async function reconnectMcp(model: string): Promise<ConnectMcpResult> {
  const transport = httpTransports[model];
  if (transport) {
    try {
      await transport.close();
    } catch (err) {
      log({
        msg: `[${model}] Error closing transport on reconnect: ${err}`,
        logLevel: "warn",
      });
    }
    delete clients[model];
    delete httpTransports[model];
  }
  sessionIds[model] = undefined;
  const cfg = mcpConfigs[model];
  if (!cfg) {
    return { model, client: null, connected: false };
  }
  return reconnectMcpImpl(model, cfg, clients);
}

/** Injected for tests; default is connectMcp. */
let reconnectMcpImpl: (
  model: string,
  cfg: McpToolConfig,
  clients: Record<string, Client>,
) => Promise<ConnectMcpResult> = connectMcp;

/**
 * Call a tool on the MCP server for a given model.
 * On session invalid (404 or "Session not found"), reconnects and retries once.
 * If client is missing (e.g. after server restart), tries to connect once using stored config.
 */
export async function callMcp(
  model: string,
  toolName: string,
  args: string,
): Promise<ToolResponse> {
  let client = clients[model];
  if (!client && mcpConfigs[model]) {
    const reconnected = await connectMcp(model, mcpConfigs[model], clients);
    if (reconnected.connected && reconnected.client) {
      client = reconnected.client;
    }
  }
  if (!client) {
    return { content: `MCP client not initialized: ${model}` };
  }
  const parsedArgs = JSON.parse(args);
  const doCall = (c: Client) =>
    c.callTool({
      name: toolName,
      arguments: parsedArgs,
    });
  try {
    const result = await doCall(client);
    return {
      content: typeof result.content === "string" ? result.content : JSON.stringify(result.content),
    };
  } catch (err: unknown) {
    const hasHttpState = httpTransports[model] ?? mcpConfigs[model];
    if (isSessionInvalidError(err) && hasHttpState) {
      const reconnected = await reconnectMcp(model);
      if (!reconnected.connected || !reconnected.client) {
        return {
          content: `MCP call error: session invalid (404), reconnect failed`,
        };
      }
      try {
        const result = await doCall(reconnected.client);
        return {
          content:
            typeof result.content === "string" ? result.content : JSON.stringify(result.content),
        };
      } catch (retryErr: unknown) {
        const message =
          typeof retryErr === "object" && retryErr !== null && "message" in retryErr
            ? (retryErr as { message?: string }).message || ""
            : String(retryErr);
        return { content: `MCP call error: ${message}` };
      }
    }
    let message;
    if (typeof err === "object" && err !== null && "message" in err) {
      message = (err as { message?: string }).message || "";
    } else {
      message = String(err);
    }
    return { content: `MCP call error: ${message}` };
  }
}
