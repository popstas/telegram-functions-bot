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
  const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
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

export function basicAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic');
    return res.status(401).send('Authentication required.');
  }

  const [username, password] = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');

  if (username === process.env.HTTP_USER && password === process.env.HTTP_PASSWORD) {
    return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic');
  return res.status(401).send('Invalid credentials.');
}
