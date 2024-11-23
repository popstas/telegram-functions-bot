import express from "express";

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogParams {
  msg: string;
  logLevel?: LogLevel;
  chatId?: number;
  chatTitle?: string;
  username?: string;
  role?: 'system' | 'user' | 'assistant' | 'tool';
}

export function log({ msg, logLevel = 'info', chatId, chatTitle, username, role }: LogParams) {
  const tzoffset = (new Date()).getTimezoneOffset() * 60000; //offset in milliseconds
  const timestamp = new Date(Date.now() - tzoffset).toISOString().slice(0, 19).replace('T', ' ');
  const chatIdStr = chatId ? `[${chatId}] ` : '';
  if (msg.includes('\n')) {
    msg = msg.replace(/\n/g, ' ');
  }
  const roleStr = role ? `[${role}] ` : '';
  const chatTitleStr = chatTitle ? `[${chatTitle}] ` : '';
  const usernameStr = username ? `[${username}] ` : '';
  const logLevelStr = logLevel !== 'info' ? `[${logLevel.toUpperCase()}] ` : '';
  const logMessage = `[${timestamp}] ${chatIdStr}${logLevelStr}${chatTitleStr}${roleStr}${usernameStr}${msg}`;

  switch (logLevel) {
    case 'debug':
      console.debug(logMessage);
      break;
    case 'info':
      console.info(logMessage);
      break;
    case 'warn':
      console.warn(logMessage);
      break;
    case 'error':
      console.error(logMessage);
      break;
    default:
      console.log(logMessage);
  }
}

export function sendToHttp(res: express.Response | undefined, text: string) {
  if (!res) return
  res.write(text + '\n')
}
