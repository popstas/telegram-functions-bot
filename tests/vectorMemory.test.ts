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
import type { ConfigChatType } from "../src/types";

jest.unstable_mockModule("../src/helpers/useApi.ts", () => ({
  useApi: () => ({
    embeddings: {
      create: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    },
  }),
}));

let embeddings: typeof import("../src/helpers/embeddings.ts");

function baseChat(): ConfigChatType {
  return {
    id: 1,
    name: "test",
    completionParams: {},
    chatParams: { vectorMemory: true },
    toolParams: { vectorMemory: { dimension: 3 } },
  } as ConfigChatType;
}

beforeEach(async () => {
  jest.resetModules();
  embeddings = await import("../src/helpers/embeddings.ts");
});

afterEach(() => {
  fs.rmSync("data", { recursive: true, force: true });
});

describe("defaultMemoryDbPath", () => {
  it("uses username for private chats", async () => {
    const chat = { ...baseChat(), username: "alice" } as ConfigChatType;
    await embeddings.saveEmbedding({ text: "hello", metadata: {}, chat });
    const expected = path.join("data", "memory", "private", "alice.sqlite");
    expect(fs.existsSync(expected)).toBe(true);
    expect(chat.toolParams?.vectorMemory?.dbPath).toBe(expected);
    embeddings.closeDb(expected);
  });

  it("uses bot_name for bot chats", async () => {
    const chat = { ...baseChat(), bot_name: "mybot" } as ConfigChatType;
    await embeddings.saveEmbedding({ text: "hello", metadata: {}, chat });
    const expected = path.join("data", "memory", "bots", "mybot.sqlite");
    expect(fs.existsSync(expected)).toBe(true);
    expect(chat.toolParams?.vectorMemory?.dbPath).toBe(expected);
    embeddings.closeDb(expected);
  });

  it("uses sanitized group name for group chats", async () => {
    const chat = { ...baseChat(), name: "My Group!", id: 42 } as ConfigChatType;
    await embeddings.saveEmbedding({ text: "hello", metadata: {}, chat });
    const expected = path.join("data", "memory", "groups", "my_group.sqlite");
    expect(fs.existsSync(expected)).toBe(true);
    expect(chat.toolParams?.vectorMemory?.dbPath).toBe(expected);
    embeddings.closeDb(expected);
  });

  it("allows Cyrillic characters in group name", async () => {
    const chat = { ...baseChat(), name: "Группа", id: 123 } as ConfigChatType;
    await embeddings.saveEmbedding({ text: "hello", metadata: {}, chat });
    const expected = path.join("data", "memory", "groups", "группа.sqlite");
    expect(fs.existsSync(expected)).toBe(true);
    expect(chat.toolParams?.vectorMemory?.dbPath).toBe(expected);
    embeddings.closeDb(expected);
  });

  it("falls back to chat id when name sanitizes empty", async () => {
    const chat = { ...baseChat(), name: "!!!", id: 456 } as ConfigChatType;
    await embeddings.saveEmbedding({ text: "hello", metadata: {}, chat });
    const expected = path.join("data", "memory", "groups", "456.sqlite");
    expect(fs.existsSync(expected)).toBe(true);
    expect(chat.toolParams?.vectorMemory?.dbPath).toBe(expected);
    embeddings.closeDb(expected);
  });
});
