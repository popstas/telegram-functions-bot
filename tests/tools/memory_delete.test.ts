import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { ConfigChatType, ThreadStateType } from "../../src/types";

const mockSendTelegramMessage = jest.fn();
const mockConfirm = jest.fn();
const mockDeleteEmbedding = jest.fn();
const mockSearchEmbedding = jest.fn();

jest.unstable_mockModule("../../src/helpers/useApi.ts", () => ({
  useApi: () => ({
    embeddings: {
      create: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    },
  }),
}));

jest.unstable_mockModule("../../src/telegram/send.ts", () => ({
  sendTelegramMessage: (...args: unknown[]) => mockSendTelegramMessage(...args),
}));

jest.unstable_mockModule("../../src/telegram/confirm.ts", () => ({
  telegramConfirm: (...args: unknown[]) => mockConfirm(...args),
}));

jest.unstable_mockModule("../../src/helpers/embeddings.ts", () => ({
  deleteEmbedding: (...args: unknown[]) => mockDeleteEmbedding(...args),
  searchEmbedding: (...args: unknown[]) => mockSearchEmbedding(...args),
}));

let mod: typeof import("../../src/tools/memory_delete.ts");

function cfg(): ConfigChatType {
  return {
    name: "c",
    agent_name: "a",
    id: 1,
    completionParams: {},
    chatParams: { vector_memory: true },
    toolParams: { vector_memory: { dbPath: "", dimension: 3 } },
  } as ConfigChatType;
}

beforeEach(async () => {
  jest.resetModules();
  mockSendTelegramMessage.mockClear();
  mockConfirm.mockReset();
  mockDeleteEmbedding.mockReset();
  mockSearchEmbedding.mockReset();
  mod = await import("../../src/tools/memory_delete.ts");
});

describe("memory_delete", () => {
  it("deletes matching entries", async () => {
    const chat = cfg();
    const thread: ThreadStateType = {
      id: 1,
      msgs: [],
      messages: [],
      completionParams: {},
    } as ThreadStateType;
    const rows = [{ date: "d", text: "hello world" }];
    mockSearchEmbedding.mockResolvedValue(rows);
    mockDeleteEmbedding.mockResolvedValue(rows);
    mockConfirm.mockImplementation(({ onConfirm }) => onConfirm());
    const client = new mod.MemoryDeleteClient(chat, thread);
    const res = await client.memory_delete({ query: "hello", limit: 1 });
    expect(mockSearchEmbedding).toHaveBeenCalledWith({
      query: "hello",
      limit: 1,
      chat,
    });
    expect(mockDeleteEmbedding).toHaveBeenCalledWith({
      query: "hello",
      limit: 1,
      chat,
    });
    expect(res.content).toBe("Deleted:\nd hello world");
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      1,
      expect.stringContaining("Удалено"),
      undefined,
      undefined,
      chat,
    );
  });

  it("cancels deletion", async () => {
    const chat = cfg();
    const thread: ThreadStateType = {
      id: 1,
      msgs: [],
      messages: [],
      completionParams: {},
    } as ThreadStateType;
    const rows = [{ date: "d", text: "hello world" }];
    mockSearchEmbedding.mockResolvedValue(rows);
    mockDeleteEmbedding.mockResolvedValue(rows);
    mockConfirm.mockImplementation(({ onCancel }) => onCancel());
    const client = new mod.MemoryDeleteClient(chat, thread);
    const res = await client.memory_delete({ query: "hello", limit: 1 });
    expect(res.content).toBe("Deletion canceled");
    expect(mockDeleteEmbedding).not.toHaveBeenCalled();
    expect(mockSendTelegramMessage).not.toHaveBeenCalled();
  });
});
