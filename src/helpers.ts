type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogParams {
  msg: string;
  logLevel?: LogLevel;
  chatId?: number;
  username?: string;
  role?: 'system' | 'user' | 'assistant' | 'tool';
}

export function log({ msg, logLevel = 'info', chatId, username, role }: LogParams) {
  const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const chatIdStr = chatId ? `[${chatId}] ` : '';
  if (msg.includes('\n')) {
    msg = msg.replace(/\n/g, ' ');
  }
  const roleStr = role ? `[${role}] ` : '';
  const usernameStr = username ? `[${username}] ` : '';
  const logLevelStr = logLevel !== 'info' ? `[${logLevel.toUpperCase()}] ` : '';
  const logMessage = `[${timestamp}] ${logLevelStr}${chatIdStr}${roleStr}${usernameStr}${msg}`;

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
