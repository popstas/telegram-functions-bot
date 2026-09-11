import { Message } from "grammy/types";

import { log } from "../helpers.ts";
import type { BotContext } from "../telegram/botContext.ts";
import type { RelayAnswerConfigType } from "../types.ts";

const DEFAULT_TIMEOUT_SEC = 120;

/** Asks the runner. Any failure is an empty string: the agent then stays silent. */
export async function requestAnswer(
  cfg: RelayAnswerConfigType,
  payload: { text: string; author: string; message_id: number },
): Promise<string> {
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout((cfg.timeout ?? DEFAULT_TIMEOUT_SEC) * 1000),
    });
    if (!res.ok) {
      log({ msg: `Relay answer: runner returned ${res.status}`, logLevel: "warn" });
      return "";
    }
    const data = (await res.json()) as { answer?: string };
    return (data.answer ?? "").trim();
  } catch (error) {
    log({ msg: `Relay answer: ${(error as Error).message}`, logLevel: "warn" });
    return "";
  }
}

/** Message text: caption, plain text, or the transcript of a voice message. */
async function messageText(ctx: BotContext, msg: Message): Promise<string> {
  const plain = (msg.text || msg.caption || "").trim();
  if (plain) return plain;
  const voice = (msg as Message.VoiceMessage).voice || (msg as Message.AudioMessage).audio;
  if (!voice) return "";
  // Imported on demand: relay.ts must not drag the whole audio chain into its
  // module graph just because a voice message might arrive.
  const { transcribe } = await import("./onAudio.ts");
  return (await transcribe(ctx, voice)).trim();
}

export async function answerAfterRelay(
  ctx: BotContext,
  msg: Message,
  copies: Map<number, number>,
  cfg: RelayAnswerConfigType,
): Promise<void> {
  const text = await messageText(ctx, msg);
  if (!text) return;

  const answer = await requestAnswer(cfg, {
    text,
    author: msg.from?.username || String(msg.from?.id ?? ""),
    message_id: msg.message_id,
  });
  if (!answer) return;

  const toAuthor = cfg.send_to === "author";
  const targetId = toAuthor ? msg.chat.id : Number(cfg.send_to);
  // In the group the reply points at the copy, in the private chat at the original.
  const replyTo = toAuthor ? msg.message_id : copies.get(targetId);
  // The transcript is for the group only: leadership cannot judge an answer to a
  // voice message without hearing it. The author needs no retelling of their own voice.
  const body = !toAuthor && !msg.text && !msg.caption ? `> ${text}\n\n${answer}` : answer;

  await ctx.api.sendMessage(
    targetId,
    body,
    replyTo ? { reply_parameters: { message_id: replyTo } } : undefined,
  );
}
