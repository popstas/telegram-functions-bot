import { Context } from "telegraf";
import { message, editedMessage } from "telegraf/filters";
import { Message } from "telegraf/types";
import { useConfig, validateConfig, watchConfigChanges } from "./config.ts";
import { initCommands, handleAddChat } from "./commands.ts";
import { log } from "./helpers.ts";
import { initTools } from "./helpers/useTools.ts";
import express from "express";
import { useBot } from "./bot";
import onTextMessage from "./handlers/onTextMessage.ts";
import onPhoto from "./handlers/onPhoto.ts";
import onAudio from "./handlers/onAudio.ts";
import onDocument from "./handlers/onDocument.ts";
import onUnsupported from "./handlers/onUnsupported.ts";
import { useLastCtx } from "./helpers/lastCtx.ts";
import {
  agentGetHandler,
  agentPostHandler,
  toolPostHandler,
} from "./httpHandlers.ts";
import { useMqtt } from "./mqtt.ts";
import { healthHandler } from "./healthcheck.ts";

process.on("unhandledRejection", (reason) => {
  log({ msg: `Unhandled rejection: ${reason}`, logLevel: "error" });
});

process.on("uncaughtException", (error, source) => {
  console.log("Uncaught Exception:", error);
  console.log("source:", source);
});

process.env.DOTENV_CONFIG_QUIET = "true";
if (process.env.NODE_ENV !== "test") {
  void start();
}

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
    for (const c of chatBots) {
      try {
        await launchBot(c.bot_token!, c.bot_name!);
      } catch (error: unknown) {
        console.error(`Error launching bot ${c.bot_name}:`, error);
      }
    }

    // Initialize HTTP server
    initHttp();
    useMqtt();
    await initTools();
  } catch (error: unknown) {
    console.error("Error during bot startup:", error);
    console.log("restart after 10 seconds...");
    setTimeout(start, 10000);
  }
}

async function launchBot(bot_token: string, bot_name: string) {
  try {
    const bot = useBot(bot_token);

    // Set up help command
    bot.help(async (ctx) =>
      ctx.reply("https://github.com/popstas/telegram-functions-bot"),
    );

    // Initialize commands with proper error handling
    await initCommands(bot);

    // Set up message handlers
    bot.on([message("text"), editedMessage("text")], onTextMessage);
    bot.on(message("photo"), onPhoto);
    bot.on(message("voice"), onAudio);
    bot.on(message("audio"), onAudio);
    bot.on(message("sticker"), onUnsupported);
    bot.on(message("video"), onUnsupported);
    bot.on(message("video_note"), onUnsupported);
    bot.on(message("document"), onDocument);

    bot.catch((err, ctx) => {
      log({
        msg: `[${bot_name}] Unhandled error for update ${ctx.update.update_id}: ${err instanceof Error ? err.message : String(err)}`,
        logLevel: "error",
      });
      if (err instanceof Error) {
        console.error(err.stack);
      }
    });

    // Set up chat action handler
    bot.action("add_chat", handleAddChat);

    // Start the bot
    void bot.launch().catch((error) => {
      log({
        msg: `[${bot_name}] Error during bot launch: ${error instanceof Error ? error.message : String(error)}`,
        logLevel: "error",
      });
      console.error(error.stack);
    });

    log({ msg: `bot started: ${bot_name}` });
    return bot;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "response" in error) {
      const errorWithResponse = error as { response?: { statusCode?: number } };
      if (errorWithResponse.response?.statusCode === 401) {
        log({
          msg: `[${bot_name}] Error: Invalid bot token (401 Unauthorized). Please check your bot token in the config.`,
          logLevel: "error",
        });
      } else {
        log({
          msg: `[${bot_name}] Error during bot launch (2): ${error instanceof Error ? error.message : String(error)}`,
          logLevel: "error",
        });
      }
    } else {
      log({
        msg: `[${bot_name}] Error during bot launch (3): ${error instanceof Error ? error.message : String(error)}`,
        logLevel: "error",
      });
    }
  }
}

function createHttpApp() {
  // Validate HTTP configuration
  if (!useConfig().http) {
    log({
      msg: `Invalid http configuration in config, skip http server init`,
      logLevel: "warn",
    });
    return null;
  }

  const port = useConfig().http.port || 7586;

  // Set up express server
  const app = express();
  app.use(express.json());

  // Set default content type with UTF-8 encoding for all responses
  app.use((_req, res, next) => {
    res.contentType("application/json; charset=utf-8");
    next();
  });

  // Add /ping test route
  app.get("/ping", (_req, res) => {
    res.send("pong");
  });

  app.get("/health", healthHandler);

  // Add route handler to create a virtual message and call onMessage
  app.post("/telegram/:chatId", telegramPostHandler);
  app.get("/telegram/test", telegramPostHandlerTest);
  // call agent by name
  app.get("/agent/:agentName", agentGetHandler);
  app.post("/agent/:agentName", agentPostHandler);
  // call tool directly
  app.post("/agent/:agentName/tool/:toolName", toolPostHandler);

  return { app, port };
}

function initHttp() {
  const result = createHttpApp();
  if (!result) return null;
  const { app, port } = result;
  app.listen(port, () => {
    log({ msg: `http server listening on port ${port}` });
  });
  return app;
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
          res.contentType("text/plain; charset=utf-8");
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

export {
  start,
  launchBot,
  createHttpApp,
  initHttp,
  telegramPostHandler,
  telegramPostHandlerTest,
};
