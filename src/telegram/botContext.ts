import { Context } from "grammy";
import type { Response } from "express";

/** App-level props layered onto grammY's Context (former ad-hoc intersection casts). */
export interface BotFlavor {
  secondTry?: boolean;
  businessConnectionId?: string;
  businessOwnerUsername?: string;
  expressRes?: Response;
  noSendTelegram?: boolean;
  progressCallback?: (msg: string) => void;
}

export type BotContext = Context & BotFlavor;

export const FLAVOR_KEYS = [
  "secondTry",
  "businessConnectionId",
  "businessOwnerUsername",
  "expressRes",
  "noSendTelegram",
  "progressCallback",
] as const satisfies readonly (keyof BotFlavor)[];

/** Copy flavor props onto a (usually freshly constructed) Context. */
export function attachFlavor(from: Partial<BotFlavor>, to: Context): BotContext {
  const target = to as BotContext;
  for (const key of FLAVOR_KEYS) {
    const value = from[key];
    if (value !== undefined) {
      (target as Record<string, unknown>)[key] = value;
    }
  }
  return target;
}
