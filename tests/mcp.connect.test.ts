import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { McpToolConfig } from "../src/types.ts";

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

class MockUnauthorizedError extends Error {
  constructor(message?: string) {
    super(message ?? "Unauthorized");
    this.name = "UnauthorizedError";
  }
}

const mockCreateAuthProvider = jest.fn().mockReturnValue(undefined);
const mockStorePendingAuth = jest.fn();

jest.unstable_mockModule("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: MockClient,
}));

jest.unstable_mockModule("@modelcontextprotocol/sdk/client/stdio", () => ({
  StdioClientTransport: StdioTransportMock,
}));

jest.unstable_mockModule("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: StreamableTransportMock,
  StreamableHTTPError: class StreamableHTTPError extends Error {
    constructor(
      public code: number | undefined,
      message: string | undefined,
    ) {
      super(message);
      this.name = "StreamableHTTPError";
    }
  },
}));

jest.unstable_mockModule("@modelcontextprotocol/sdk/client/auth.js", () => ({
  UnauthorizedError: MockUnauthorizedError,
}));

jest.unstable_mockModule("@modelcontextprotocol/sdk/types.js", () => ({
  LoggingMessageNotificationSchema: {},
  ResourceListChangedNotificationSchema: {},
  ListResourcesResultSchema: {},
}));

jest.unstable_mockModule("../src/helpers.ts", () => ({
  __esModule: true,
  log: (...args: unknown[]) => mockLog(...args),
  safeFilename: jest.fn(),
  stringToId: jest.fn(),
}));

jest.unstable_mockModule("../src/mcp-auth.ts", () => ({
  createAuthProvider: (...args: unknown[]) => mockCreateAuthProvider(...args),
  storePendingAuth: (...args: unknown[]) => mockStorePendingAuth(...args),
}));

let connectMcp: typeof import("../src/mcp.ts").connectMcp;
let init: typeof import("../src/mcp.ts").init;

beforeEach(async () => {
  jest.resetModules();
  mockLog.mockReset();
  mockClientConnect.mockReset();
  StdioTransportMock.mockReset();
  StreamableTransportMock.mockReset();
  mockCreateAuthProvider.mockReset().mockReturnValue(undefined);
  mockStorePendingAuth.mockReset();
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

  it("connects using url", async () => {
    const cfg = { url: "http://srv" } as McpToolConfig;
    const clients = {};
    const transport = {};
    StreamableTransportMock.mockReturnValue(transport);
    // Using type assertion to bypass type checking for tests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await connectMcp("m2", cfg, clients as any);
    expect(StreamableTransportMock).toHaveBeenCalledWith(new URL("http://srv"), {
      sessionId: undefined,
      authProvider: undefined,
    });
    expect(mockClientConnect).toHaveBeenCalledWith(transport);
    expect(res.connected).toBe(true);
  });

  it("serverUrl still works and logs deprecation", async () => {
    const cfg = { serverUrl: "http://srv" } as McpToolConfig;
    const clients = {};
    const transport = {};
    StreamableTransportMock.mockReturnValue(transport);
    // Using type assertion to bypass type checking for tests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await connectMcp("m2", cfg, clients as any);
    expect(StreamableTransportMock).toHaveBeenCalledWith(new URL("http://srv"), {
      sessionId: undefined,
      authProvider: undefined,
    });
    expect(res.connected).toBe(true);
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining("serverUrl is deprecated"),
        logLevel: "warn",
      }),
    );
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
    const cfg = { url: "http://srv" } as McpToolConfig;
    const clients = {};
    mockClientConnect.mockRejectedValueOnce(new Error("fail"));
    // Using type assertion to bypass type checking for tests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await connectMcp("m4", cfg, clients as any);
    expect(res).toEqual({ model: "m4", client: null, connected: false });
    expect(mockLog).toHaveBeenCalled();
  });

  it("passes authProvider to transport when auth config exists", async () => {
    const fakeProvider = { redirectUrl: "https://cb.example.com" };
    mockCreateAuthProvider.mockReturnValue(fakeProvider);

    const cfg = {
      url: "http://srv",
      auth: { callbackUrl: "https://cb.example.com" },
    } as McpToolConfig;
    const clients = {};
    const transport = {};
    StreamableTransportMock.mockReturnValue(transport);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await connectMcp("m5", cfg, clients as any);

    expect(mockCreateAuthProvider).toHaveBeenCalledWith("m5", cfg, undefined);
    expect(StreamableTransportMock).toHaveBeenCalledWith(new URL("http://srv"), {
      sessionId: undefined,
      authProvider: fakeProvider,
    });
    expect(res.connected).toBe(true);
  });

  it("handles UnauthorizedError and stores pending auth", async () => {
    const fakeProvider = { redirectUrl: "https://cb.example.com" };
    mockCreateAuthProvider.mockReturnValue(fakeProvider);

    const cfg = {
      url: "http://srv",
      auth: { callbackUrl: "https://cb.example.com" },
    } as McpToolConfig;
    const clients = {};
    const transport = {};
    StreamableTransportMock.mockReturnValue(transport);
    mockClientConnect.mockRejectedValueOnce(new MockUnauthorizedError());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await connectMcp("m6", cfg, clients as any);

    expect(res.connected).toBe(false);
    expect(res.client).toBeNull();
    expect(mockStorePendingAuth).toHaveBeenCalledWith("m6", transport, "m6");
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining("OAuth authorization pending"),
        logLevel: "warn",
      }),
    );
  });

  it("does not pass authProvider when no auth config", async () => {
    const cfg = { url: "http://srv" } as McpToolConfig;
    const clients = {};
    const transport = {};
    StreamableTransportMock.mockReturnValue(transport);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await connectMcp("m7", cfg, clients as any);

    expect(mockCreateAuthProvider).toHaveBeenCalledWith("m7", cfg, undefined);
    expect(StreamableTransportMock).toHaveBeenCalledWith(new URL("http://srv"), {
      sessionId: undefined,
      authProvider: undefined,
    });
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
      m1: { url: "http://one" } as McpToolConfig,
      m2: { command: "cmd" } as McpToolConfig,
    });
    expect(res).toEqual([{ name: "t1", description: "d", properties: {}, model: "m1" }]);
  });

  it("logs loading time", async () => {
    listToolsMock.mockResolvedValue({ tools: [] });
    StreamableTransportMock.mockReturnValue({});
    await init({ m1: { url: "http://one" } as McpToolConfig });
    const msgs = mockLog.mock.calls.map((c) => c[0].msg);
    expect(msgs.some((m) => m.includes("MCP loaded for"))).toBe(true);
  });
});
