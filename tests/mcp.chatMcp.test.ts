import { jest, describe, it, beforeEach, expect } from "@jest/globals";

let getChatMcpKey: typeof import("../src/mcp.ts").getChatMcpKey;
let disconnectMcp: typeof import("../src/mcp.ts").disconnectMcp;
let disconnectChatMcp: typeof import("../src/mcp.ts").disconnectChatMcp;
let __test: typeof import("../src/mcp.ts").__test;

beforeEach(async () => {
  jest.resetModules();
  ({ getChatMcpKey, disconnectMcp, disconnectChatMcp, __test } = await import("../src/mcp.ts"));
  __test.resetClients();
});

describe("getChatMcpKey", () => {
  it("returns namespaced key", () => {
    expect(getChatMcpKey(123, "fetch")).toBe("chat_123_fetch");
  });

  it("handles negative chat IDs (group chats)", () => {
    expect(getChatMcpKey(-100456, "server")).toBe("chat_-100456_server");
  });
});

describe("disconnectMcp", () => {
  it("removes client from state", async () => {
    const mockClose = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const client = {
      close: mockClose,
    } as unknown as import("@modelcontextprotocol/sdk/client/index.js").Client;
    __test.setClient("test-key", client);

    await disconnectMcp("test-key");
    expect(mockClose).toHaveBeenCalled();
  });

  it("handles missing client gracefully", async () => {
    await expect(disconnectMcp("nonexistent")).resolves.toBeUndefined();
  });

  it("ignores close errors", async () => {
    const mockClose = jest.fn<() => Promise<void>>().mockRejectedValue(new Error("close failed"));
    const client = {
      close: mockClose,
    } as unknown as import("@modelcontextprotocol/sdk/client/index.js").Client;
    __test.setClient("test-key", client);

    await expect(disconnectMcp("test-key")).resolves.toBeUndefined();
  });
});

describe("disconnectChatMcp", () => {
  it("disconnects all clients with matching chat prefix", async () => {
    const mockClose1 = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const mockClose2 = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const mockClose3 = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

    const client1 = {
      close: mockClose1,
    } as unknown as import("@modelcontextprotocol/sdk/client/index.js").Client;
    const client2 = {
      close: mockClose2,
    } as unknown as import("@modelcontextprotocol/sdk/client/index.js").Client;
    const client3 = {
      close: mockClose3,
    } as unknown as import("@modelcontextprotocol/sdk/client/index.js").Client;

    __test.setClient("chat_123_server1", client1);
    __test.setClient("chat_123_server2", client2);
    __test.setClient("chat_456_server1", client3);

    await disconnectChatMcp(123);

    expect(mockClose1).toHaveBeenCalled();
    expect(mockClose2).toHaveBeenCalled();
    expect(mockClose3).not.toHaveBeenCalled();
  });

  it("handles no matching clients gracefully", async () => {
    await expect(disconnectChatMcp(999)).resolves.toBeUndefined();
  });
});
