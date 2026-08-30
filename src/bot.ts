import { Bot } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import type { RunnerHandle } from "@grammyjs/runner";
import { HttpsProxyAgent } from "https-proxy-agent";
import { useConfig } from "./config.ts";
import type { BotContext } from "./telegram/botContext.ts";

const bots: Record<string, Bot<BotContext>> = {};
const initPromises: Record<string, Promise<void>> = {};
const runnerHandles: Record<string, RunnerHandle> = {};

export function useBot(bot_token?: string): Bot<BotContext> {
  const config = useConfig();
  const token = bot_token || config.auth.bot_token;
  if (!bots[token]) {
    const proxyUrl = config.auth.proxy_url;
    const bot = new Bot<BotContext>(
      token,
      proxyUrl
        ? { client: { baseFetchConfig: { agent: new HttpsProxyAgent(proxyUrl), compress: true } } }
        : undefined,
    );
    // Centralized 429 handling for ALL outbound calls (incl. rich drafts).
    bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }));
    bots[token] = bot;
    // botInfo: grammY forbids assignment (throwing getter before init) — run init
    // eagerly; launch/HTTP paths await botReady() before reading bot.botInfo.
    const init = bot.init();
    initPromises[token] = init;
    init.catch(() => {
      // surfaced via botReady() awaiters (e.g. 401 in launchBot); avoid unhandledRejection
      delete bots[token];
      delete initPromises[token];
    });
  }
  return bots[token];
}

export function botReady(bot_token?: string): Promise<void> {
  const token = bot_token || useConfig().auth.bot_token;
  useBot(token);
  return initPromises[token] ?? Promise.reject(new Error(`bot init failed for token`));
}

export function getBots(): Record<string, Bot<BotContext>> {
  return bots;
}

export function setRunnerHandle(token: string, handle: RunnerHandle): void {
  runnerHandles[token] = handle;
}

export function getRunnerHandles(): Record<string, RunnerHandle> {
  return runnerHandles;
}
