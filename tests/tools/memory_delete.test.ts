import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import type { ConfigChatType, ThreadStateType } from "../../src/types";

jest.unstable_mockModule("../../src/helpers/useApi.ts", () => ({
  useApi: () => ({
    embeddings: {
      create: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    },
  }),
}));

const mockSendTelegramMessage = jest.fn();

jest.unstable_mockModule("../../src/telegram/send.ts", () => ({
  sendTelegramMessage: (...args: unknown[]) => mockSendTelegramMessage(...args),
}));

let embeddings: typeof import("../../src/helpers/embeddings.ts");
let mod: typeof import("../../src/tools/memory_delete.ts");

function cfg(dbPath: string): ConfigChatType {
  return {
    name: "c",
    agent_name: "a",
    id: 1,
    completionParams: {},
    chatParams: { vector_memory: true },
    toolParams: { vector_memory: { dbPath, dimension: 3 } },
  } as ConfigChatType;
}

beforeEach(async () => {
  jest.resetModules();
  mockSendTelegramMessage.mockClear();
  embeddings = await import("../../src/helpers/embeddings.ts");
  mod = await import("../../src/tools/memory_delete.ts");
});

describe("memory_delete", () => {
  it("deletes matching entries", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vec-"));
    const db = path.join(dir, "db.sqlite");
    const chat = cfg(db);
    const thread: ThreadStateType = {
      id: 1,
      msgs: [],
      messages: [],
      completionParams: {},
    } as ThreadStateType;
    await embeddings.saveEmbedding({ text: "hello world", metadata: {}, chat });
    const client = new mod.MemoryDeleteClient(chat, thread);
    const res = await client.memory_delete({ query: "hello", limit: 1 });
    expect(res.content).toContain("hello world");
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      1,
      expect.stringContaining("Удалено"),
      undefined,
      undefined,
      chat,
    );
    const rows = await embeddings.searchEmbedding({
      query: "hello",
      limit: 1,
      chat,
    });
    expect(rows).toHaveLength(0);
    embeddings.closeDb(db);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
