import {Context} from 'telegraf'
import {message, editedMessage} from 'telegraf/filters'
import {Message} from 'telegraf/types'
import {
  ConfigChatType,
} from './types.ts'
import {validateConfig, writeConfig, watchConfigChanges} from './config.ts'
import {initCommands} from './commands.ts'
import {log} from './helpers.ts';
import express from 'express';
import { useBot } from './bot';
import { useConfig } from './config';
import onMessage from "./helpers/onMessage.ts";
import {useLastCtx} from "./helpers/lastCtx.ts";


process.on('uncaughtException', (error, source) => {
  console.log('Uncaught Exception:', error)
  console.log('source:', source)
})

void start()

async function start() {
  // global
  const config = useConfig();
  if (!validateConfig(config)) {
    console.log('Invalid config, exiting...')
    process.exit(1)
  }
  watchConfigChanges();

  try {
    const bot = useBot();
    log({msg: 'bot started'})

    bot.help(async ctx => ctx.reply('https://github.com/popstas/telegram-functions-bot'))

    await initCommands(bot)

    bot.on([message('text'), editedMessage('text')], onMessage)

    bot.action('add_chat', async (ctx) => {
      const chatId = ctx.chat?.id;
      // @ts-ignore
      const chatName = ctx.chat?.title || `Chat ${chatId}`;
      if (!chatId) return;

      const newChat = {name: chatName, id: chatId} as ConfigChatType;
      config.chats.push(newChat);
      writeConfig(undefined, config);
      await ctx.reply(`Chat added: ${chatName}`);
    });

    process.once('SIGINT', () => bot.stop('SIGINT'))
    process.once('SIGTERM', () => bot.stop('SIGTERM'))
    void bot.launch()

    // Initialize HTTP server
    initHttp();
  } catch (e) {
    console.log('restart after 10 seconds...')
    setTimeout(start, 10000)
  }
}


function initHttp() {
  // Validate HTTP configuration
  if (!useConfig().http) {
    log({msg: `Invalid http configuration in config, skip http server init`, logLevel: 'warn'});
    return
  }

  const port = useConfig().http.port || 7586;

  // Set up express server
  const app = express();
  app.use(express.json());

  // Add /ping test route
  app.get('/ping', (req, res) => {
    res.send('pong');
  });

  // Add route handler to create a virtual message and call onMessage
  // @ts-ignore
  app.post('/telegram/:chatId', telegramPostHandler);
  // @ts-ignore
  app.get('/telegram/test', telegramPostHandlerTest);

  app.listen(port, () => {
    console.log(`Express server listening on port ${port}`);
  });
}

async function telegramPostHandlerTest(req: express.Request, res: express.Response) {
  req.params = {chatId: "-4534736935"}
  req.body = {text: 'На сервере высокий load average. Проверь, есть ли необычное в процессах, скажи да или нет noconfirm'}
  return telegramPostHandler(req, res)
}

async function telegramPostHandler(req: express.Request, res: express.Response) {
  const {chatId} = req.params;
  const {text} = req.body || '';

  log({msg: `POST /telegram/${chatId}: ${text}`})

  if (!text) {
    return res.status(400).send('Message text is required.');
  }

  const chatConfig = useConfig().chats.find(chat => chat.id === parseInt(chatId));
  if (!chatConfig) {
    log({msg: `http: Chat ${chatId} not found in config`, logLevel: 'warn'});
    return res.status(400).send('Wrong chat_id')
  }

  const chat = {id: parseInt(chatId), title: chatConfig.name}
  const from = {username: useConfig().http.telegram_from_username}
  const virtualCtx = {
    chat,
    update: {
      message: {text, chat, from},
    }
  };

  const ctx = useLastCtx() as Context & { update: any, chat: any, expressRes?: Express.Response }
  if (!ctx) {
    log({msg: `http: lastCtx not found`, logLevel: 'warn', chatId: chat.id, chatTitle: chat.title});
    return res.status(500).send('lastCtx not found.');
  }

  ctx.update.message = virtualCtx.update.message
  ctx.chat.id = virtualCtx.chat.id
  ctx.chat.title = virtualCtx.chat.title

  try {
    ctx.expressRes = res
    await onMessage(ctx as Context, async (sentMsg: Message.TextMessage) => {
      if (sentMsg) {
        const text = (sentMsg as Message.TextMessage).text;
        res.end(text);
      } else {
        res.status(500).send('Error sending message.');
      }
      // await useBot().telegram.sendMessage(chat.id, 'test - ' + text);
    });
  } catch (error) {
    res.status(500).send('Error sending message.');
  }
}
