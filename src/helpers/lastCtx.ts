import type { Api } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { BotContext } from "../telegram/botContext.ts";

let lastApi: { api: Api; me: UserFromGetMe } | undefined;
let lastCtx: BotContext | undefined;

export function setLastCtx(ctx: BotContext) {
  lastCtx = ctx;
  if (ctx?.api && ctx?.me) lastApi = { api: ctx.api, me: ctx.me };
}

export function getLastApi() {
  return lastApi;
}

/** @deprecated transitional — removed in the HTTP-handler task once index.ts stops spreading contexts. */
export function useLastCtx() {
  return lastCtx;
}
