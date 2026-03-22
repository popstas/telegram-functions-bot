import { Telegraf } from "telegraf";
import { HttpsProxyAgent } from "https-proxy-agent";
import { useConfig } from "./config.ts";

const bots: Record<string, Telegraf> = {};

export function useBot(bot_token?: string): Telegraf {
  const config = useConfig();
  bot_token = bot_token || config.auth.bot_token;
  if (!bots[bot_token]) {
    const proxyUrl = config.auth.proxy_url;
    const bot = new Telegraf(
      bot_token,
      proxyUrl ? { telegram: { agent: new HttpsProxyAgent(proxyUrl) } } : {},
    );
    bots[bot_token] = bot;
    bot.telegram.getMe().then((botInfo) => {
      bot.botInfo = botInfo;
    });
    process.once("SIGINT", () => bots[bot_token].stop("SIGINT"));
    process.once("SIGTERM", () => bots[bot_token].stop("SIGTERM"));
  }
  return bots[bot_token];
}

export function getBots(): Record<string, Telegraf> {
  return bots;
}
