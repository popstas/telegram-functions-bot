import {Context} from "telegraf";

let lastCtx = {} as Context

export function setLastCtx(ctx: Context) {
  lastCtx = ctx
}

export function useLastCtx() {
  return lastCtx
}