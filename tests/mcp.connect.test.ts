import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { McpToolConfig } from "../src/types";

const mockLog = jest.fn();
const mockClientConnect = jest.fn();
const listToolsMock = jest.fn().mockResolvedValue({ tools: [] });

// Create a mock client constructor that can be called with 'new'
function MockClient() {
  // Return an instance with the mock methods
  return {
    connect: mockClientConnect,
    setNotificationHandler: jest.fn(),
    request: jest.fn(),
    listTools: (...args: unknown[]) => listToolsMock(...args),
  };
}

// For TypeScript compatibility
const createMockClient = (): ReturnType<typeof MockClient> =>
  new (MockClient as unknown as { new (): ReturnType<typeof MockClient> })();

const StdioTransportMock = jest.fn();
const StreamableTransportMock = jest.fn();

jest.unstable_mockModule("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: MockClient,
}));

jest.unstable_mockModule("@modelcontextprotocol/sdk/client/stdio", () => ({
  StdioClientTransport: StdioTransportMock,
}));

jest.unstable_mockModule(
  "@modelcontextprotocol/sdk/client/streamableHttp.js",
  () => ({
    StreamableHTTPClientTransport: StreamableTransportMock,
  }),
);

jest.unstable_mockModule("@modelcontextprotocol/sdk/types.js", () => ({
  LoggingMessageNotificationSchema: {},
  ResourceListChangedNotificationSchema: {},
  ListResourcesResultSchema: {},
}));

jest.unstable_mockModule("../src/helpers.ts", () => ({
  log: (...args: unknown[]) => mockLog(...args),
}));

let connectMcp: typeof import("../src/mcp.ts").connectMcp;
let init: typeof import("../src/mcp.ts").init;

beforeEach(async () => {
  jest.resetModules();
  mockLog.mockReset();
  mockClientConnect.mockReset();
  StdioTransportMock.mockReset();
  StreamableTransportMock.mockReset();
  ({ connectMcp, init } = await import("../src/mcp.ts"));
});

describe("connectMcp", () => {
  it("returns existing client", async () => {
    const existing = createMockClient();
    const clients = { m1: existing };
    // Using type assertion to bypass type checking for tests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await connectMcp("m1", {} as McpToolConfig, clients as any);
    expect(res).toEqual({ model: "m1", client: existing, connected: true });
  });

  it("connects using serverUrl", async () => {
    const cfg = { serverUrl: "http://srv" } as McpToolConfig;
    const clients = {};
    const transport = {};
    StreamableTransportMock.mockReturnValue(transport);
    // Using type assertion to bypass type checking for tests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await connectMcp("m2", cfg, clients as any);
    expect(StreamableTransportMock).toHaveBeenCalledWith(
      new URL("http://srv"),
      {
        sessionId: undefined,
      },
    );
    expect(mockClientConnect).toHaveBeenCalledWith(transport);
    expect(res.connected).toBe(true);
  });

  it("connects using command", async () => {
    const cfg = {
      command: "run",
      args: ["a"],
      env: { X: "1" },
    } as McpToolConfig;
    const clients = {};
    const transport = {};
    StdioTransportMock.mockReturnValue(transport);
    // Using type assertion to bypass type checking for tests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await connectMcp("m3", cfg, clients as any);
    expect(StdioTransportMock).toHaveBeenCalledWith({
      command: "run",
      args: ["a"],
      env: expect.objectContaining({ X: "1" }),
    });
    expect(mockClientConnect).toHaveBeenCalledWith(transport);
    expect(res.connected).toBe(true);
  });

  it("handles connection errors", async () => {
    const cfg = { serverUrl: "http://srv" } as McpToolConfig;
    const clients = {};
    mockClientConnect.mockRejectedValueOnce(new Error("fail"));
    // Using type assertion to bypass type checking for tests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await connectMcp("m4", cfg, clients as any);
    expect(res).toEqual({ model: "m4", client: null, connected: false });
    expect(mockLog).toHaveBeenCalled();
  });
});

describe("init", () => {
  it("aggregates tools from models", async () => {
    listToolsMock
      .mockResolvedValueOnce({
        tools: [{ name: "t1", description: "d", inputSchema: {} }],
      })
      .mockResolvedValueOnce({ tools: [] });
    StreamableTransportMock.mockReturnValue({});
    StdioTransportMock.mockReturnValue({});
    const res = await init({
      m1: { serverUrl: "http://one" } as McpToolConfig,
      m2: { command: "cmd" } as McpToolConfig,
    });
    expect(res).toEqual([
      { name: "t1", description: "d", properties: {}, model: "m1" },
    ]);
  });

  it("logs loading time", async () => {
    listToolsMock.mockResolvedValue({ tools: [] });
    StreamableTransportMock.mockReturnValue({});
    await init({ m1: { serverUrl: "http://one" } as McpToolConfig });
    const msgs = mockLog.mock.calls.map((c) => c[0].msg);
    expect(msgs.some((m) => m.includes("MCP loaded for"))).toBe(true);
  });
});
