import type DatabaseModule from "better-sqlite3";
import type * as DB from "better-sqlite3";
import { load } from "sqlite-vec";
import path from "node:path";
import { createRequire } from "node:module";
import { useApi } from "./useApi.ts";
import { updateChatInConfig, useConfig } from "../config.ts";
import { ensureDirectoryExists, safeFilename } from "../helpers.ts";
import type { ConfigChatType, VectorMemoryParamsType } from "../types.ts";

const require = createRequire(import.meta.url);

const dbCache = new Map<string, DB.Database>();
let databaseCtor: typeof DatabaseModule | null = null;
let moduleLoadFailed = false;
let moduleWarningLogged = false;

export function shouldLoadBetterSqlite3(): boolean {
  if (process.env.BETTER_SQLITE3_ALLOW_ELECTRON === "1") {
    return true;
  }
  if (typeof process.versions?.electron === "string") {
    return false;
  }
  return true;
}

function warnVectorMemoryDisabled(error?: unknown) {
  if (moduleWarningLogged) {
    return;
  }
  moduleWarningLogged = true;
  const reason =
    error instanceof Error
      ? `${error.message} (${error.name})`
      : error
        ? String(error)
        : "unknown error";
  const guidance =
    "Vector memory features are disabled until the native bindings are rebuilt for the current runtime. See README.md#native-modules-better-sqlite3 for rebuild instructions.";
  console.warn(`[vector-memory] better-sqlite3 failed to load (${reason}). ${guidance}`);
}

function loadDatabaseConstructor(): typeof DatabaseModule | null {
  if (databaseCtor) {
    return databaseCtor;
  }
  if (moduleLoadFailed) {
    return null;
  }
  if (!shouldLoadBetterSqlite3()) {
    moduleLoadFailed = true;
    warnVectorMemoryDisabled(
      "Electron runtime detected; skipping better-sqlite3 load (set BETTER_SQLITE3_ALLOW_ELECTRON=1 after rebuilding the module for Electron).",
    );
    return null;
  }
  try {
    const loaded = require("better-sqlite3") as typeof DatabaseModule;
    databaseCtor = loaded;
    return loaded;
  } catch (error) {
    moduleLoadFailed = true;
    warnVectorMemoryDisabled(error);
    return null;
  }
}

export function defaultMemoryDbPath(chat: ConfigChatType): string {
  if (chat.username) return path.join("data", "memory", "private", `${chat.username}.sqlite`);
  if (chat.bot_name) return path.join("data", "memory", "bots", `${chat.bot_name}.sqlite`);
  const safe = safeFilename(`${chat.name || chat.id}`, `${chat.id}`);
  return path.join("data", "memory", "groups", `${safe}.sqlite`);
}

function resolveDbPath(chat: ConfigChatType): string {
  const toolParams = (chat.toolParams = chat.toolParams || {});
  let vectorMemory = toolParams.vector_memory as VectorMemoryParamsType | undefined;
  if (!vectorMemory) {
    vectorMemory = {
      dbPath: defaultMemoryDbPath(chat),
      dimension: 1536,
    };
    toolParams.vector_memory = vectorMemory;
    updateChatInConfig(chat);
  } else if (!vectorMemory.dbPath) {
    vectorMemory.dbPath = defaultMemoryDbPath(chat);
    updateChatInConfig(chat);
  }
  return vectorMemory.dbPath;
}

function initDb(dbPath: string, dimension: number): DB.Database | null {
  const cached = dbCache.get(dbPath);
  if (cached) {
    return cached;
  }
  const Database = loadDatabaseConstructor();
  if (!Database) {
    warnVectorMemoryDisabled();
    return null;
  }
  ensureDirectoryExists(dbPath);
  const db = new Database(dbPath);
  load(db);
  db.exec(
    `create virtual table if not exists memory using vec0(embedding float[${dimension}], text TEXT, date TEXT, metadata TEXT)`,
  );
  dbCache.set(dbPath, db);
  return db;
}

export async function embedText(text: string, chat?: ConfigChatType): Promise<number[]> {
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
  const dimension = chat.toolParams?.vector_memory?.dimension || 1536;
  const db = initDb(dbPath, dimension);
  if (!db) return;
  const embedding = await embedText(text, chat);
  const existing = db
    .prepare(
      "select text, distance from memory where embedding match json(?) order by distance limit 1",
    )
    .get(JSON.stringify(embedding)) as { text: string; distance: number } | undefined;
  if (existing && (existing.text === text || existing.distance < 0.01)) return;
  const stmt = db.prepare(
    "insert into memory(embedding, text, date, metadata) values (json(?), ?, ?, json(?))",
  );
  stmt.run(JSON.stringify(embedding), text, new Date().toISOString(), JSON.stringify(metadata));
}

export async function searchEmbedding(params: {
  query: string;
  limit: number;
  chat: ConfigChatType;
}): Promise<{ text: string; date: string; metadata: unknown; distance: number }[]> {
  const { query, limit, chat } = params;
  const dbPath = resolveDbPath(chat);
  const dimension = chat.toolParams?.vector_memory?.dimension || 1536;
  const db = initDb(dbPath, dimension);
  if (!db) return [];
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

export function previewEmbedding(row: { date: string; text: string; distance: number }): string {
  const date = new Date(row.date).toISOString().slice(0, 16).replace("T", " ");
  return `${date} ${row.text} (${row.distance.toFixed(2)})`;
}

export async function deleteEmbedding(params: {
  query: string;
  limit: number;
  chat: ConfigChatType;
}): Promise<{ text: string; date: string }[]> {
  const { query, limit, chat } = params;
  const dbPath = resolveDbPath(chat);
  const dimension = chat.toolParams?.vector_memory?.dimension || 1536;
  const db = initDb(dbPath, dimension);
  if (!db) return [];
  const embedding = await embedText(query, chat);
  const stmt = db.prepare(
    "select rowid, text, date, distance from memory where embedding match json(?) order by distance limit ?",
  );
  const rows = stmt.all(JSON.stringify(embedding), limit) as {
    rowid: number;
    text: string;
    date: string;
    distance: number;
  }[];
  const maxDistance = chat.toolParams?.vector_memory?.deleteMaxDistance ?? 1.1;
  const del = db.prepare("delete from memory where rowid = ?");
  const deleted: { text: string; date: string }[] = [];
  for (const row of rows) {
    if (row.distance <= maxDistance) {
      del.run(row.rowid);
      deleted.push({ text: row.text, date: row.date });
    }
  }
  return deleted;
}

export function closeDb(dbPath: string) {
  const db = dbCache.get(dbPath);
  if (db) {
    db.close();
    dbCache.delete(dbPath);
  }
}

export function __resetForTests() {
  for (const db of dbCache.values()) {
    try {
      db.close();
    } catch {
      // ignore errors from closing cached handles during test cleanup
    }
  }
  dbCache.clear();
  databaseCtor = null;
  moduleLoadFailed = false;
  moduleWarningLogged = false;
}
