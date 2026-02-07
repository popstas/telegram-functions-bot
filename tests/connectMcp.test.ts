import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpToolConfig } from "../src/types.ts";

const mockConnect = jest.fn();

class MockClient {
  connect = mockConnect;
  setNotificationHandler = jest.fn();
  request = jest.fn().mockResolvedValue({ resources: [] });
  constructor(public opts: unknown) {}
}

const mockStdio = jest.fn();
const mockHttp = jest.fn();
const mockLog = jest.fn();

jest.unstable_mockModule("@modelcontextprotocol/sdk/client/index.js", () => ({
  __esModule: true,
  Client: MockClient,
}));

jest.unstable_mockModule("@modelcontextprotocol/sdk/client/stdio", () => ({
  __esModule: true,
  StdioClientTransport: function (opts: unknown) {
    mockStdio(opts);
  },
}));

jest.unstable_mockModule("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  __esModule: true,
  StreamableHTTPClientTransport: function (url: unknown, opts: unknown) {
    mockHttp(url, opts);
  },
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

jest.unstable_mockModule("../src/helpers.ts", () => ({
  __esModule: true,
  log: (...args: unknown[]) => mockLog(...args),
  safeFilename: jest.fn(),
  stringToId: jest.fn(),
}));

let connectMcp: typeof import("../src/mcp.ts").connectMcp;

beforeEach(async () => {
  jest.resetModules();
  mockConnect.mockReset();
  mockStdio.mockReset();
  mockHttp.mockReset();
  mockLog.mockReset();
  ({ connectMcp } = await import("../src/mcp.ts"));
});

describe("connectMcp", () => {
  it("returns cached client", async () => {
    const existing = {} as unknown as Client;
    const res = await connectMcp("m", {} as unknown as McpToolConfig, {
      m: existing,
    });
    expect(res).toEqual({ model: "m", client: existing, connected: true });
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("connects via url", async () => {
    const clients: Record<string, Client> = {};
    const res = await connectMcp("m", { url: "http://s" } as unknown as McpToolConfig, clients);
    expect(mockHttp).toHaveBeenCalledWith(new URL("http://s"), {
      sessionId: undefined,
    });
    expect(mockConnect).toHaveBeenCalled();
    expect(res.connected).toBe(true);
  });

  it("connects via command", async () => {
    const clients: Record<string, Client> = {};
    const res = await connectMcp(
      "m",
      {
        command: "cmd",
        args: ["a"],
        env: { A: "1" },
      } as unknown as McpToolConfig,
      clients,
    );
    expect(mockStdio).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "cmd",
        args: ["a"],
        env: expect.objectContaining({
          A: "1",
          NODE_OPTIONS: expect.stringContaining("--unhandled-rejections=warn"),
        }),
      }),
    );
    expect(mockConnect).toHaveBeenCalled();
    expect(res.connected).toBe(true);
  });

  it("returns disconnected on error", async () => {
    mockConnect.mockRejectedValue(new Error("bad"));
    const res = await connectMcp("m", { url: "http://s" } as unknown as McpToolConfig, {});
    expect(res).toEqual({ model: "m", client: null, connected: false });
    expect(mockLog).toHaveBeenCalled();
  });

  it("handles missing transport", async () => {
    const res = await connectMcp("m", {} as unknown as McpToolConfig, {});
    expect(res.connected).toBe(false);
  });
});
