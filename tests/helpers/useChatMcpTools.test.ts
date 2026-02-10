import { jest, describe, it, beforeEach, expect } from "@jest/globals";
import * as fs from "fs";

const mockLog = jest.fn();
const mockReadConfig = jest.fn();
const mockReaddirSync = jest.fn();
const mockInitChatMcp = jest.fn();
const mockDisconnectChatMcp = jest.fn();
const mockGetChatMcpKey = jest.fn();
const mockCallMcp = jest.fn();
const mockSendTelegramMessage = jest.fn();
const mockInitMcp = jest.fn() as unknown as jest.MockedFunction<
  typeof import("../../src/mcp").init
>;

jest.unstable_mockModule("fs", () => ({
  __esModule: true,
  ...(jest.requireActual("fs") as object),
  readdirSync: mockReaddirSync,
}));

jest.unstable_mockModule("../../src/helpers.ts", () => ({
  __esModule: true,
  log: (...args: unknown[]) => mockLog(...args),
  stringToId: jest.fn(),
}));

jest.unstable_mockModule("../../src/config.ts", () => ({
  readConfig: () => mockReadConfig(),
  updateChatInConfig: jest.fn(),
}));

jest.unstable_mockModule("../../src/mcp.ts", () => ({
  init: (config: unknown) => mockInitMcp(config),
  callMcp: (...args: unknown[]) => mockCallMcp(...args),
  initChatMcp: (...args: unknown[]) => mockInitChatMcp(...args),
  disconnectChatMcp: (...args: unknown[]) => mockDisconnectChatMcp(...args),
  getChatMcpKey: (...args: unknown[]) => mockGetChatMcpKey(...args),
}));

jest.unstable_mockModule("../../src/telegram/send.ts", () => ({
  sendTelegramMessage: (...args: unknown[]) => mockSendTelegramMessage(...args),
  sendTelegramDocument: jest.fn(),
  getFullName: () => "User",
  isAdminUser: jest.fn(),
}));

import type { ConfigChatType, ThreadStateType } from "../../src/types.ts";

let useChatMcpTools: typeof import("../../src/helpers/useTools.ts").useChatMcpTools;
let cleanupChatMcpTools: typeof import("../../src/helpers/useTools.ts").cleanupChatMcpTools;
let __testChatMcp: typeof import("../../src/helpers/useTools.ts").__testChatMcp;

const fooPath = "src/tools/usechatmcptools_test_foo.ts";

beforeAll(() => {
  fs.writeFileSync(fooPath, "export function call() { return { content: 'foo' }; }");
});

afterAll(() => {
  if (fs.existsSync(fooPath)) fs.unlinkSync(fooPath);
});

beforeEach(async () => {
  jest.resetModules();
  jest.clearAllMocks();
  mockReaddirSync.mockReturnValue([]);
  mockReadConfig.mockReturnValue({});
  mockInitMcp.mockResolvedValue([]);
  mockInitChatMcp.mockResolvedValue([]);
  mockDisconnectChatMcp.mockResolvedValue(undefined);
  mockGetChatMcpKey.mockImplementation((chatId: number, name: string) => `chat_${chatId}_${name}`);

  ({ useChatMcpTools, cleanupChatMcpTools, __testChatMcp } = await import(
    "../../src/helpers/useTools.ts"
  ));
});

afterEach(() => {
  __testChatMcp.clearState();
});

const baseConfig: ConfigChatType = {
  name: "test",
  completionParams: { model: "gpt-5-mini" },
  chatParams: {},
  toolParams: {},
};

describe("useChatMcpTools", () => {
  it("returns empty array when no mcpServers configured", async () => {
    const result = await useChatMcpTools(123, baseConfig);
    expect(result).toEqual([]);
    expect(mockInitChatMcp).not.toHaveBeenCalled();
  });

  it("returns empty array when mcpServers is empty object", async () => {
    const result = await useChatMcpTools(123, { ...baseConfig, mcpServers: {} });
    expect(result).toEqual([]);
  });

  it("initializes MCP tools on first call", async () => {
    mockInitChatMcp.mockResolvedValue([
      { name: "tool1", description: "desc1", properties: {}, model: "chat_100_srv1" },
    ]);

    const config: ConfigChatType = {
      ...baseConfig,
      mcpServers: { srv1: { command: "uvx", args: ["server"] } },
    };

    const result = await useChatMcpTools(100, config);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("tool1");
    expect(mockInitChatMcp).toHaveBeenCalledWith(
      100,
      { srv1: { command: "uvx", args: ["server"] } },
      expect.any(Function),
    );
  });

  it("caches tools on second call with same config", async () => {
    mockInitChatMcp.mockResolvedValue([
      { name: "tool1", description: "desc1", properties: {}, model: "chat_100_srv1" },
    ]);

    const config: ConfigChatType = {
      ...baseConfig,
      mcpServers: { srv1: { command: "uvx", args: ["server"] } },
    };

    const result1 = await useChatMcpTools(100, config);
    const result2 = await useChatMcpTools(100, config);

    expect(result1).toEqual(result2);
    expect(mockInitChatMcp).toHaveBeenCalledTimes(1);
  });

  it("re-initializes when config changes", async () => {
    mockInitChatMcp
      .mockResolvedValueOnce([
        { name: "tool1", description: "desc1", properties: {}, model: "chat_100_srv1" },
      ])
      .mockResolvedValueOnce([
        { name: "tool2", description: "desc2", properties: {}, model: "chat_100_srv2" },
      ]);

    const config1: ConfigChatType = {
      ...baseConfig,
      mcpServers: { srv1: { command: "uvx", args: ["server1"] } },
    };
    const config2: ConfigChatType = {
      ...baseConfig,
      mcpServers: { srv2: { command: "uvx", args: ["server2"] } },
    };

    const result1 = await useChatMcpTools(100, config1);
    expect(result1[0].name).toBe("tool1");

    const result2 = await useChatMcpTools(100, config2);
    expect(result2[0].name).toBe("tool2");

    expect(mockInitChatMcp).toHaveBeenCalledTimes(2);
    expect(mockDisconnectChatMcp).toHaveBeenCalledWith(100);
  });

  it("cleans up when mcpServers removed from config", async () => {
    mockInitChatMcp.mockResolvedValue([
      { name: "tool1", description: "desc1", properties: {}, model: "chat_100_srv1" },
    ]);

    const configWith: ConfigChatType = {
      ...baseConfig,
      mcpServers: { srv1: { command: "uvx", args: ["server"] } },
    };

    await useChatMcpTools(100, configWith);
    expect(__testChatMcp.getState()[100]).toBeDefined();

    const result = await useChatMcpTools(100, baseConfig);
    expect(result).toEqual([]);
    expect(mockDisconnectChatMcp).toHaveBeenCalledWith(100);
    expect(__testChatMcp.getState()[100]).toBeUndefined();
  });

  it("deduplicates concurrent init calls", async () => {
    let resolveInit: (value: unknown[]) => void;
    mockInitChatMcp.mockReturnValue(
      new Promise((resolve) => {
        resolveInit = resolve;
      }),
    );

    const config: ConfigChatType = {
      ...baseConfig,
      mcpServers: { srv1: { command: "uvx", args: ["server"] } },
    };

    const p1 = useChatMcpTools(100, config);
    const p2 = useChatMcpTools(100, config);

    resolveInit!([{ name: "tool1", description: "d", properties: {}, model: "chat_100_srv1" }]);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(r2);
    expect(mockInitChatMcp).toHaveBeenCalledTimes(1);
  });

  it("passes onAuthUrl callback that sends to telegram", async () => {
    let capturedOnAuthUrl: ((url: URL) => void) | undefined;
    mockInitChatMcp.mockImplementation(
      (_chatId: unknown, _configs: unknown, onAuthUrl: unknown) => {
        capturedOnAuthUrl = onAuthUrl as (url: URL) => void;
        return Promise.resolve([]);
      },
    );

    const config: ConfigChatType = {
      ...baseConfig,
      mcpServers: {
        srv1: { url: "https://example.com/mcp", auth: { callbackUrl: "https://cb.example.com" } },
      },
    };

    await useChatMcpTools(200, config);

    expect(capturedOnAuthUrl).toBeDefined();
    capturedOnAuthUrl!(new URL("https://auth.example.com/authorize"));

    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      200,
      expect.stringContaining("https://auth.example.com/authorize"),
    );
  });

  it("creates proper ChatToolType that calls MCP", async () => {
    mockInitChatMcp.mockResolvedValue([
      {
        name: "my_tool",
        description: "A tool",
        properties: { type: "object" },
        model: "chat_100_srv1",
      },
    ]);
    mockCallMcp.mockResolvedValue({ content: "result" });

    const config: ConfigChatType = {
      ...baseConfig,
      mcpServers: { srv1: { command: "uvx", args: ["server"] } },
    };

    const tools = await useChatMcpTools(100, config);
    expect(tools).toHaveLength(1);

    const tool = tools[0];
    expect(tool.name).toBe("my_tool");

    const instance = tool.module.call({} as ConfigChatType, {} as ThreadStateType);
    expect(instance.mcp).toBe(true);
    await instance.functions.get("my_tool")("{}");
    expect(mockCallMcp).toHaveBeenCalledWith("chat_100_srv1", "my_tool", "{}");
  });

  it("handles init error gracefully", async () => {
    mockInitChatMcp.mockRejectedValue(new Error("connection failed"));

    const config: ConfigChatType = {
      ...baseConfig,
      mcpServers: { srv1: { command: "bad", args: [] } },
    };

    const result = await useChatMcpTools(100, config);
    expect(result).toEqual([]);
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining("connection failed"),
        logLevel: "error",
      }),
    );
  });
});

describe("cleanupChatMcpTools", () => {
  it("disconnects and removes state for a chat", async () => {
    mockInitChatMcp.mockResolvedValue([
      { name: "tool1", description: "d", properties: {}, model: "chat_100_srv1" },
    ]);

    const config: ConfigChatType = {
      ...baseConfig,
      mcpServers: { srv1: { command: "uvx", args: ["server"] } },
    };

    await useChatMcpTools(100, config);
    expect(__testChatMcp.getState()[100]).toBeDefined();

    await cleanupChatMcpTools(100);
    expect(__testChatMcp.getState()[100]).toBeUndefined();
    expect(mockDisconnectChatMcp).toHaveBeenCalledWith(100);
  });

  it("does nothing for unknown chat", async () => {
    await cleanupChatMcpTools(999);
    expect(mockDisconnectChatMcp).not.toHaveBeenCalled();
  });
});
