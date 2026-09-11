import { Message } from "grammy/types";
import type { NextFunction } from "grammy";

import { getCtxChatMsg } from "../telegram/context.ts";
import { getFullName, sendTelegramMessage } from "../telegram/send.ts";
import { resolveRecipientChatId } from "../helpers/recipients.ts";
import { answerAfterRelay } from "./relayAnswer.ts";
import { log } from "../helpers.ts";
import type { BotContext } from "../telegram/botContext.ts";
import type { RelayMessageType } from "../types.ts";

export const DEFAULT_RELAY_HEADER = "{name} (@{username}), {date} {time}";

// An album arrives as several updates sharing media_group_id. Send the header once
// per group per target, so the group reads as one post instead of N headed copies.
const MEDIA_GROUP_TTL_MS = 60_000;
const headerSent = new Map<string, number>();

function markHeaderSent(key: string, now: number) {
  for (const [k, at] of headerSent) {
    if (now - at > MEDIA_GROUP_TTL_MS) headerSent.delete(k);
  }
  headerSent.set(key, now);
}

/** True when this media group already got its header on this target within the TTL. */
function isHeaderSent(key: string, now: number): boolean {
  const at = headerSent.get(key);
  return at !== undefined && now - at <= MEDIA_GROUP_TTL_MS;
}

export function detectMessageType(msg: Message): RelayMessageType {
  const types: RelayMessageType[] = [
    "text",
    "voice",
    "audio",
    "photo",
    "video",
    "video_note",
    "document",
    "sticker",
    "animation",
    "location",
    "contact",
    "poll",
  ];
  const found = types.find((type) => type in msg);
  return found ?? "other";
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function renderHeader(template: string, msg: Message, now: Date): string {
  const values: Record<string, string> = {
    // Deliberately msg.from, not the forward origin: the header names who sent this
    // to the bot, so a manager forwarding a client message is still credited.
    name: getFullName({ from: msg.from }) || msg.from?.username || "",
    username: msg.from?.username || "",
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
  return template
    .replace(/\{(name|username|date|time)\}/g, (_, key: string) => values[key] ?? "")
    .replace(/\s*\(@\)/g, "") // author has no username: drop the empty "(@)" the template leaves behind
    .trim();
}

/**
 * Copy the incoming message to every `chatParams.relay.send_to` target.
 * Returns true when the message was relayed and must not reach the LLM handlers.
 */
export async function relayMessage(ctx: BotContext, now = new Date()): Promise<boolean> {
  const { msg, chat } = getCtxChatMsg(ctx);
  if (!msg || !chat) return false;

  const relay = chat.chatParams?.relay;
  if (!relay?.send_to?.length) return false;

  const type = detectMessageType(msg);
  if (relay.types?.length && !relay.types.includes(type)) return false;

  const chatId = msg.chat.id;

  // A chat config can match the target itself (e.g. `id` set to the group the bot posts
  // into). Copying a chat into itself would relay the copy again, forever — drop those
  // targets, and when nothing else remains treat the message as not ours.
  const targets = relay.send_to
    .map((recipient) => ({ recipient, targetId: resolveRecipientChatId(recipient) }))
    .filter(({ targetId }) => targetId !== chatId);
  if (!targets.length) return false;

  const header = renderHeader(relay.header ?? DEFAULT_RELAY_HEADER, msg, now);
  let relayed = 0;
  // targetId -> message_id of the copy, so the agent answer can reply to it.
  const copies = new Map<number, number>();

  for (const { recipient, targetId } of targets) {
    if (!targetId) {
      log({
        msg: `Relay: could not resolve recipient: ${recipient}`,
        chatId,
        logLevel: "warn",
      });
      continue;
    }

    try {
      if (header) {
        const mediaGroupId = (msg as { media_group_id?: string }).media_group_id;
        const groupKey = mediaGroupId ? `${mediaGroupId}:${targetId}` : undefined;
        if (!groupKey || !isHeaderSent(groupKey, now.getTime())) {
          await ctx.api.sendMessage(targetId, header);
          if (groupKey) markHeaderSent(groupKey, now.getTime());
        }
      }
      const copied = await ctx.api.copyMessage(targetId, chatId, msg.message_id);
      // The id is what the answer replies to. Relaying itself must not depend on it.
      if (copied?.message_id) copies.set(targetId, copied.message_id);
      relayed++;
      log({
        msg: `Relay: ${type} from ${msg.from?.username || msg.from?.id} sent to ${targetId}`,
        chatId,
        logLevel: "info",
      });
    } catch (error) {
      log({
        msg: `Relay: error sending to ${recipient}: ${(error as Error).message}`,
        chatId,
        logLevel: "warn",
      });
    }
  }

  // Nothing left, the author would silently think the commit went through.
  if (!relayed) {
    await sendTelegramMessage(chatId, "Не удалось переслать сообщение", undefined, ctx);
    return true;
  }

  if (relay.reply) await sendTelegramMessage(chatId, relay.reply, undefined, ctx);

  // An agent run takes tens of seconds. The confirmation is already out, nobody waits.
  if (relay.answer) {
    void answerAfterRelay(ctx, msg, copies, relay.answer).catch((error) =>
      log({ msg: `Relay answer failed: ${(error as Error).message}`, chatId, logLevel: "warn" }),
    );
  }
  return true;
}

/** grammY middleware: relay chats never fall through to the LLM handlers. */
export default async function relayMiddleware(ctx: BotContext, next: NextFunction) {
  if (await relayMessage(ctx)) return;
  await next();
}

export const __testRelay = {
  reset: () => headerSent.clear(),
};
