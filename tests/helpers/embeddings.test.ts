import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { load } from "sqlite-vec";
import type { ConfigChatType } from "../../src/types.ts";
import {
  generateConfig,
  setConfigPath,
  writeConfig,
} from "../../src/config.ts";

jest.unstable_mockModule("../../src/helpers/useApi.ts", () => ({
  useApi: () => ({
    embeddings: {
      create: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    },
  }),
}));

let embeddings: typeof import("../../src/helpers/embeddings.ts");

function baseChat(): ConfigChatType {
  return {
    id: 1,
    name: "test",
    completionParams: {},
    chatParams: { vector_memory: true },
    toolParams: { vector_memory: { dimension: 3 } },
  } as ConfigChatType;
}

function writeChat(chat: ConfigChatType) {
  const config = generateConfig();
  config.chats.push(chat);
  writeConfig("data/test-config.yml", config);
}

beforeEach(async () => {
  jest.resetModules();
  process.env.CONFIG = "data/test-config.yml";
  setConfigPath("data/test-config.yml");
  embeddings = await import("../../src/helpers/embeddings.ts");
});

afterEach(() => {
  fs.rmSync("data/test-config.yml", { force: true });
  delete process.env.CONFIG;
  setConfigPath("config.yml");
});

describe("saveEmbedding", () => {
  it("skips duplicate entries", async () => {
    const chat = baseChat();
    writeChat(chat);
    await embeddings.saveEmbedding({ text: "hello", metadata: {}, chat });
    await embeddings.saveEmbedding({ text: "hello", metadata: {}, chat });
    const dbPath = path.join("data", "memory", "groups", "test.sqlite");
    const db = new Database(dbPath);
    load(db);
    const row = db.prepare("select count(*) as c from memory").get() as {
      c: number;
    };
    expect(row.c).toBe(1);
    db.close();
    embeddings.closeDb(dbPath);
    fs.rmSync(dbPath, { force: true });
  });
});
