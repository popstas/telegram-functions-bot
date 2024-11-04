type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogParams {
  msg: string;
  logLevel: LogLevel;
  chatId?: number;
  role?: 'system' | 'user' | 'assistant' | 'tool';
}

export function log({ msg, logLevel, chatId, role }: LogParams) {
  const timestamp = new Date().toISOString();
  const chatIdStr = chatId ? `Chat ID: ${chatId}` : '';
  const roleStr = role ? `Role: ${role}` : '';
  const logLevelStr = logLevel !== 'info' ? `[${logLevel.toUpperCase()}] ` : '';
  const logMessage = `[${timestamp}] ${logLevelStr}${chatIdStr} ${roleStr} ${msg}`;

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
