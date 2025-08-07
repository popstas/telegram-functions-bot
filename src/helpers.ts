import express from "express";
import fs from "fs";
import path from "path";

type LogLevel = "debug" | "verbose" | "info" | "warn" | "error";

interface LogParams {
  msg: string;
  logLevel?: LogLevel;
  chatId?: number;
  chatTitle?: string;
  username?: string;
  role?: "system" | "user" | "assistant" | "tool";
  logPath?: string;
}

export function log({
  msg,
  logLevel = "info",
  chatId,
  chatTitle,
  username,
  role,
  logPath = "data/messages.log",
}: LogParams) {
  const tzoffset = new Date().getTimezoneOffset() * 60000; //offset in milliseconds
  const timestamp = new Date(Date.now() - tzoffset).toISOString().slice(0, 19).replace("T", " ");
  const chatIdStr = chatId ? `[${chatId}] ` : "";
  if (msg.includes("\n")) {
    msg = msg.replace(/\n/g, " ");
  }
  const roleStr = role ? `[${role}] ` : "";
  const chatTitleStr = chatTitle ? `[${chatTitle}] ` : "";
  const usernameStr = username ? `[${username}] ` : "";
  const logLevelStr = logLevel !== "info" ? `[${logLevel.toUpperCase()}] ` : "";
  const logMessage = `[${timestamp}] ${chatIdStr}${logLevelStr}${chatTitleStr}${roleStr}${usernameStr}${msg}`;

  // Write logMessage to the specified log file
  if (logPath) {
    ensureDirectoryExists(logPath);
    fs.appendFileSync(path.resolve(logPath), logMessage + "\n");
  }

  switch (logLevel) {
    case "debug":
      console.debug(logMessage);
      break;
    case "info":
      console.info(logMessage);
      break;
    case "warn":
      console.warn(logMessage);
      break;
    case "error":
      console.error(logMessage);
      break;
  }
}

export function ensureDirectoryExists(filePath: string) {
  const directory = path.dirname(filePath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

export function safeFilename(filename: string, def: string): string {
  const safe = filename
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/g, "_")
    .replace(/^_|_$/g, "");
  return safe || def;
}

export function sendToHttp(res: express.Response | undefined, text: string) {
  if (!res) return;
  res.write(text + "\n");
}

export function agentNameToId(agentName: string): number {
  let hash = 0;

  if (agentName.length === 0) return hash;

  for (let i = 0; i < agentName.length; i++) {
    const char = agentName.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  return Math.abs(hash);
}
