import type { Api } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { BotContext } from "../telegram/botContext.ts";

let lastApi: { api: Api; me: UserFromGetMe } | undefined;

export function setLastCtx(ctx: BotContext) {
  if (ctx?.api && ctx?.me) lastApi = { api: ctx.api, me: ctx.me };
}

export function getLastApi() {
  return lastApi;
}
