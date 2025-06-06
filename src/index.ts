import { Context } from "telegraf";
import { message, editedMessage } from "telegraf/filters";
import { Message } from "telegraf/types";
import { ConfigChatType } from "./types.ts";
import {
  useConfig,
  validateConfig,
  writeConfig,
  watchConfigChanges,
} from "./config.ts";
import { initCommands } from "./commands.ts";
import { log } from "./helpers.ts";
import express from "express";
import { useBot } from "./bot";
import onTextMessage from "./helpers/onTextMessage.ts";
import onPhoto from "./helpers/onPhoto.ts";
import onAudio from "./helpers/onAudio.ts";
import onUnsupported from "./helpers/onUnsupported.ts";
import { useLastCtx } from "./helpers/lastCtx.ts";

process.on("uncaughtException", (error, source) => {
  console.log("Uncaught Exception:", error);
  console.log("source:", source);
});

void start();

async function start() {
  // global
  const config = useConfig();

  if (!validateConfig(config)) {
    console.log("Invalid config, exiting...");
    process.exit(1);
  }
  watchConfigChanges();

  try {
    await launchBot(config.auth.bot_token, config.bot_name);
    // log({msg: 'bot started'});

    const chatBots = config.chats.filter((c) => c.bot_token && c.bot_name);
    chatBots.forEach((c) => launchBot(c.bot_token!, c.bot_name!));

    // Initialize HTTP server
    initHttp();
  } catch (error: unknown) {
    console.error("Error during bot startup:", error);
    console.log("restart after 10 seconds...");
    setTimeout(start, 10000);
  }
}

async function launchBot(bot_token: string, bot_name: string) {
  const config = useConfig();
  const bot = useBot(bot_token);
  bot.help(async (ctx) =>
    ctx.reply("https://github.com/popstas/telegram-functions-bot"),
  );
  await initCommands(bot);
  bot.on([message("text"), editedMessage("text")], onTextMessage);
  bot.on(message("photo"), onPhoto);
  bot.on(message("voice"), onAudio);
  bot.on(message("audio"), onAudio);
  bot.on(message("sticker"), onUnsupported);
  bot.on(message("video"), onUnsupported);
  bot.on(message("video_note"), onUnsupported);
  bot.on(message("document"), onUnsupported);

  bot.action("add_chat", async (ctx) => {
    const chatId = ctx.chat?.id;
    // @ts-expect-error title may not exist on chat type
    const chatName = ctx.chat?.title || `Chat ${chatId}`;
    if (!chatId) return;

    const newChat = { name: chatName, id: chatId } as ConfigChatType;
    config.chats.push(newChat);
    writeConfig(undefined, config);
    await ctx.reply(`Chat added: ${chatName}`);
  });

  void bot.launch();
  log({ msg: `bot started: ${bot_name}` });
  return bot;
}

function initHttp() {
  // Validate HTTP configuration
  if (!useConfig().http) {
    log({
      msg: `Invalid http configuration in config, skip http server init`,
      logLevel: "warn",
    });
    return;
  }

  const port = useConfig().http.port || 7586;

  // Set up express server
  const app = express();
  app.use(express.json());

  // Add /ping test route
  app.get("/ping", (req, res) => {
    res.send("pong");
  });

  // Add route handler to create a virtual message and call onMessage
  // @ts-expect-error express types need proper request/response typing
  app.post("/telegram/:chatId", telegramPostHandler);
  // @ts-expect-error express types need proper request/response typing
  app.get("/telegram/test", telegramPostHandlerTest);

  app.listen(port, () => {
    console.log(`Express server listening on port ${port}`);
  });
}

async function telegramPostHandlerTest(
  req: express.Request,
  res: express.Response,
) {
  req.params = { chatId: "-4534736935" };
  req.body = {
    text: "На сервере высокий load average. Проверь, есть ли необычное в процессах, скажи да или нет noconfirm",
  };
  return telegramPostHandler(req, res);
}

async function telegramPostHandler(
  req: express.Request,
  res: express.Response,
) {
  const { chatId } = req.params;
  const { text } = req.body || "";

  log({ msg: `POST /telegram/${chatId}: ${text}` });

  if (!text) {
    return res.status(400).send("Message text is required.");
  }

  const chatConfig = useConfig().chats.find(
    (chat) => chat.id === parseInt(chatId),
  );
  if (!chatConfig) {
    log({ msg: `http: Chat ${chatId} not found in config`, logLevel: "warn" });
    return res.status(400).send("Wrong chat_id");
  }

  const chat = { id: parseInt(chatId), title: chatConfig.name };
  const from = { username: useConfig().http.telegram_from_username };
  const virtualCtx = {
    chat: {
      id: chat.id,
      title: chat.title,
      type: "supergroup" as const,
    },
    update: {
      update_id: Date.now(),
      message: {
        text,
        chat: {
          id: chat.id,
          title: chat.title,
          type: "supergroup" as const,
        },
        from,
        message_id: Date.now(),
        date: Math.floor(Date.now() / 1000),
      } as Message.TextMessage,
    },
  } as unknown as Context;

  const ctx = useLastCtx() as Context & {
    expressRes?: Express.Response;
  };
  if (!ctx) {
    log({
      msg: `http: lastCtx not found`,
      logLevel: "warn",
      chatId: chat.id,
      chatTitle: chat.title,
    });
    return res.status(500).send("lastCtx not found.");
  }

  // Create a new context object instead of modifying the readonly properties
  const newCtx = {
    ...ctx,
    update: virtualCtx.update,
    chat: virtualCtx.chat,
    // replace to fake action
    persistentChatAction: async (
      action: string,
      callback: () => Promise<void>,
    ) => {
      log({ msg: `persistentChatAction stub` });
      return await callback();
    },
  } as Context & {
    expressRes?: Express.Response;
  };

  try {
    newCtx.expressRes = res;
    await onTextMessage(
      newCtx as Context,
      undefined,
      async (sentMsg: Message.TextMessage) => {
        if (sentMsg) {
          const text = (sentMsg as Message.TextMessage).text;
          res.end(text);
        } else {
          res.status(500).send("Error sending message.");
        }
        // await useBot().telegram.sendMessage(chat.id, 'test - ' + text);
      },
    );
  } catch {
    res.status(500).send("Error sending message.");
  }
}
