import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import path from "path";
import type { ConfigChatType } from "../src/types.ts";
import { generateConfig, setConfigPath, writeConfig } from "../src/config.ts";

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
  embeddings = await import("../src/helpers/embeddings.ts");
});

afterEach(() => {
  // Don't remove directories, only clean up specific files
  fs.rmSync("data/test-config.yml", { force: true });
  delete process.env.CONFIG;
  setConfigPath("config.yml");
});

describe("defaultMemoryDbPath", () => {
  it("uses username for private chats", async () => {
    const chat = { ...baseChat(), username: "alice" } as ConfigChatType;
    writeChat(chat);
    await embeddings.saveEmbedding({ text: "hello", metadata: {}, chat });
    const expected = path.join("data", "memory", "private", "alice.sqlite");
    expect(fs.existsSync(expected)).toBe(true);
    expect(chat.toolParams?.vector_memory?.dbPath).toBe(expected);
    embeddings.closeDb(expected);
    // Clean up the specific database file for this test
    fs.rmSync(expected, { force: true });
  });

  it("uses bot_name for bot chats", async () => {
    const chat = { ...baseChat(), bot_name: "mybot" } as ConfigChatType;
    writeChat(chat);
    await embeddings.saveEmbedding({ text: "hello", metadata: {}, chat });
    const expected = path.join("data", "memory", "bots", "mybot.sqlite");
    expect(fs.existsSync(expected)).toBe(true);
    expect(chat.toolParams?.vector_memory?.dbPath).toBe(expected);
    embeddings.closeDb(expected);
    // Clean up the specific database file for this test
    fs.rmSync(expected, { force: true });
  });

  it("uses sanitized group name for group chats", async () => {
    const chat = { ...baseChat(), name: "My Group!", id: 42 } as ConfigChatType;
    writeChat(chat);
    await embeddings.saveEmbedding({ text: "hello", metadata: {}, chat });
    const expected = path.join("data", "memory", "groups", "my_group.sqlite");
    expect(fs.existsSync(expected)).toBe(true);
    expect(chat.toolParams?.vector_memory?.dbPath).toBe(expected);
    embeddings.closeDb(expected);
    // Clean up the specific database file for this test
    fs.rmSync(expected, { force: true });
  });

  it("allows Cyrillic characters in group name", async () => {
    const chat = { ...baseChat(), name: "Группа", id: 123 } as ConfigChatType;
    writeChat(chat);
    await embeddings.saveEmbedding({ text: "hello", metadata: {}, chat });
    const expected = path.join("data", "memory", "groups", "группа.sqlite");
    expect(fs.existsSync(expected)).toBe(true);
    expect(chat.toolParams?.vector_memory?.dbPath).toBe(expected);
    embeddings.closeDb(expected);
    // Clean up the specific database file for this test
    fs.rmSync(expected, { force: true });
  });

  it("falls back to chat id when name sanitizes empty", async () => {
    const chat = { ...baseChat(), name: "!!!", id: 456 } as ConfigChatType;
    writeChat(chat);
    await embeddings.saveEmbedding({ text: "hello", metadata: {}, chat });
    const expected = path.join("data", "memory", "groups", "456.sqlite");
    expect(fs.existsSync(expected)).toBe(true);
    expect(chat.toolParams?.vector_memory?.dbPath).toBe(expected);
    embeddings.closeDb(expected);
    // Clean up the specific database file for this test
    fs.rmSync(expected, { force: true });
  });
});
