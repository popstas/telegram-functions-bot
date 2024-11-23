import { Telegraf } from 'telegraf';
import { useConfig } from './config.ts';

const config = useConfig();
const bot = new Telegraf(config.auth.bot_token);

export function useBot() {
  return bot;
}
