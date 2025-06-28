import { Telegraf } from "telegraf";
import { useConfig } from "./config.ts";

const bots: Record<string, Telegraf> = {};

export function useBot(bot_token?: string) {
  bot_token = bot_token || useConfig().auth.bot_token;
  if (!bots[bot_token]) {
    const bot = new Telegraf(bot_token);
    bots[bot_token] = bot;
    bot.telegram.getMe().then((botInfo) => {
      bot.botInfo = botInfo;
    });
    process.once("SIGINT", () => bots[bot_token].stop("SIGINT"));
    process.once("SIGTERM", () => bots[bot_token].stop("SIGTERM"));
  }
  return bots[bot_token];
}

export function getBots() {
  return bots;
}
