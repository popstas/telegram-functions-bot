import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import type { ConfigChatType, ThreadStateType } from "../../src/types.ts";

jest.unstable_mockModule("../../src/helpers/useApi.ts", () => ({
  useApi: () => ({
    embeddings: {
      create: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    },
  }),
}));

let embeddings: typeof import("../../src/helpers/embeddings.ts");
let modAdd: typeof import("../../src/tools/memory_add.ts");
let modSearch: typeof import("../../src/tools/memory_search.ts");

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
  modAdd = await import("../../src/tools/memory_add.ts");
  modSearch = await import("../../src/tools/memory_search.ts");
});

describe("memory_add", () => {
  it("adds and can be found by search", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vec-"));
    const db = path.join(dir, "db.sqlite");
    const chat = cfg(db);
    const thread: ThreadStateType = {
      id: 1,
      msgs: [],
      messages: [],
      completionParams: {},
    } as ThreadStateType;
    const addClient = new modAdd.MemoryAddClient(chat, thread);
    const addRes = await addClient.memory_add({ text: "remember this fact" });
    expect(addRes.content).toContain("Запомнил");
    const searchClient = new modSearch.MemorySearchClient(chat, thread);
    const res = await searchClient.memory_search({ query: "fact", limit: 1 });
    expect(res.content).toContain("remember this fact");
    embeddings.closeDb(db);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
