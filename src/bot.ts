import { Telegraf } from 'telegraf';
import { useConfig } from './config.ts';

let bot: Telegraf;

export function useBot() {
  if (!bot) {
    const config = useConfig();
    bot = new Telegraf(config.auth.bot_token);
  }
  return bot;
}
