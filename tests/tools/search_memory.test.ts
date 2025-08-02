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

let embeddings: typeof import("../../src/helpers/embeddings.ts");
let mod: typeof import("../../src/tools/search_memory.ts");

function cfg(dbPath: string): ConfigChatType {
  return {
    name: "c",
    agent_name: "a",
    completionParams: {},
    chatParams: { vector_memory: true },
    toolParams: { vector_memory: { dbPath, dimension: 3 } },
  } as ConfigChatType;
}

beforeEach(async () => {
  jest.resetModules();
  embeddings = await import("../../src/helpers/embeddings.ts");
  mod = await import("../../src/tools/search_memory.ts");
});

describe("search_memory", () => {
  it("inserts and searches", async () => {
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
    const client = new mod.SearchMemoryClient(chat, thread);
    const res = await client.search_memory({ query: "hello", limit: 1 });
    expect(res.content).toContain("hello world");
    embeddings.closeDb(db);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
