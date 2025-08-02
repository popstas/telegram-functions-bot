import Database from "better-sqlite3";
import type * as DB from "better-sqlite3";
import { load } from "sqlite-vec";
import path from "node:path";
import { useApi } from "./useApi.ts";
import { useConfig } from "../config.ts";
import { ensureDirectoryExists, safeFilename } from "../helpers.ts";
import type { ConfigChatType } from "../types.ts";

const dbCache: Record<string, DB.Database> = {};

export function defaultMemoryDbPath(chat: ConfigChatType): string {
  if (chat.username)
    return path.join("data", "memory", "private", `${chat.username}.sqlite`);
  if (chat.bot_name)
    return path.join("data", "memory", "bots", `${chat.bot_name}.sqlite`);
  const safe = safeFilename(`${chat.name || chat.id}`, `${chat.id}`);
  return path.join("data", "memory", "groups", `${safe}.sqlite`);
}

function resolveDbPath(chat: ConfigChatType): string {
  const toolParams = (chat.toolParams = chat.toolParams || {});
  let vectorMemory = toolParams.vectorMemory as
    | { dbPath: string; dimension: number; alwaysSearch?: boolean }
    | undefined;
  if (!vectorMemory) {
    vectorMemory = {
      dbPath: defaultMemoryDbPath(chat),
      dimension: 1536,
    };
    toolParams.vectorMemory = vectorMemory;
  } else if (!vectorMemory.dbPath) {
    vectorMemory.dbPath = defaultMemoryDbPath(chat);
  }
  return vectorMemory.dbPath;
}

function initDb(dbPath: string, dimension: number) {
  if (!dbCache[dbPath]) {
    ensureDirectoryExists(dbPath);
    const db = new Database(dbPath);
    load(db);
    db.exec(
      `create virtual table if not exists memory using vec0(embedding float[${dimension}], text TEXT, date TEXT, metadata TEXT)`,
    );
    dbCache[dbPath] = db;
  }
  return dbCache[dbPath];
}

export async function embedText(
  text: string,
  chat?: ConfigChatType,
): Promise<number[]> {
  const api = useApi(chat?.local_model);
  const config = useConfig();
  const model = chat?.local_model
    ? config.local_models.find((m) => m.name === chat.local_model)?.model ||
      "text-embedding-3-small"
    : "text-embedding-3-small";
  const res = await api.embeddings.create({ model, input: text });
  return res.data[0].embedding as number[];
}

export async function saveEmbedding(params: {
  text: string;
  metadata: Record<string, unknown>;
  chat: ConfigChatType;
}) {
  const { text, metadata, chat } = params;
  const dbPath = resolveDbPath(chat);
  const dimension = chat.toolParams?.vectorMemory?.dimension || 1536;
  const db = initDb(dbPath, dimension);
  const embedding = await embedText(text, chat);
  const stmt = db.prepare(
    "insert into memory(embedding, text, date, metadata) values (json(?), ?, ?, json(?))",
  );
  stmt.run(
    JSON.stringify(embedding),
    text,
    new Date().toISOString(),
    JSON.stringify(metadata),
  );
}

export async function searchEmbedding(params: {
  query: string;
  limit: number;
  chat: ConfigChatType;
}): Promise<
  { text: string; date: string; metadata: unknown; distance: number }[]
> {
  const { query, limit, chat } = params;
  const dbPath = resolveDbPath(chat);
  const dimension = chat.toolParams?.vectorMemory?.dimension || 1536;
  const db = initDb(dbPath, dimension);
  const embedding = await embedText(query, chat);
  const stmt = db.prepare(
    "select text, date, metadata, distance from memory where embedding match json(?) order by distance limit ?",
  );
  const rows = stmt.all(JSON.stringify(embedding), limit) as {
    text: string;
    date: string;
    metadata: unknown;
    distance: number;
  }[];
  return rows;
}

export function closeDb(dbPath: string) {
  if (dbCache[dbPath]) {
    dbCache[dbPath].close();
    delete dbCache[dbPath];
  }
}
