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
  previewEmbedding: (row: { date: string; text: string; distance: number }) =>
    `${new Date(row.date).toISOString().slice(0, 16).replace("T", " ")} ${row.text} (${row.distance.toFixed(2)})`,
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
    const rows = [
      {
        date: "2023-01-01T10:20:30.456Z",
        text: "hello",
        distance: 0.4,
      },
      {
        date: "2023-01-02T11:30:40.123Z",
        text: "world",
        distance: 1.2,
      },
    ];
    mockSearchEmbedding.mockResolvedValue(rows);
    mockDeleteEmbedding.mockResolvedValue([rows[0]]);
    const expectedText =
      "Delete memory entries?\n" +
      "2023-01-01 10:20 hello (0.40)\n\n" +
      "Too far entries:\n" +
      "2023-01-02 11:30 world (1.20)";
    mockConfirm.mockImplementation(({ text, onConfirm }) => {
      expect(text).toBe(expectedText);
      return onConfirm();
    });
    const client = new mod.MemoryDeleteClient(chat, thread);
    const res = await client.memory_delete({ query: "hello", limit: 2 });
    expect(mockSearchEmbedding).toHaveBeenCalledWith({
      query: "hello",
      limit: 2,
      chat,
    });
    expect(mockDeleteEmbedding).toHaveBeenCalledWith({
      query: "hello",
      limit: 2,
      chat,
    });
    expect(res.content).toBe("Deleted:\n2023-01-01 10:20 hello (0.40)");
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      1,
      "Удалено записей: 1",
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
    const rows = [
      {
        date: "2023-01-01T10:20:30.456Z",
        text: "hello",
        distance: 0.4,
      },
    ];
    mockSearchEmbedding.mockResolvedValue(rows);
    mockConfirm.mockImplementation(({ text, onCancel }) => {
      expect(text).toBe(
        "Delete memory entries?\n2023-01-01 10:20 hello (0.40)\n\nToo far entries:\nNo entries",
      );
      return onCancel();
    });
    const client = new mod.MemoryDeleteClient(chat, thread);
    const res = await client.memory_delete({ query: "hello", limit: 1 });
    expect(res.content).toBe("Deletion canceled");
    expect(mockDeleteEmbedding).not.toHaveBeenCalled();
    expect(mockSendTelegramMessage).not.toHaveBeenCalled();
  });
});
