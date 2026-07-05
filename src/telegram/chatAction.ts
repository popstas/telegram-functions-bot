import type { BotContext } from "./botContext.ts";

const CHAT_ACTION_INTERVAL_MS = 4000; // Telegram shows an action ~5s; refresh under that

/**
 * Keeps a chat action ("typing", "upload_photo", ...) visible while fn runs.
 * grammY has no persistentChatAction; emulate with sendChatAction on an interval.
 * No-ops for synthetic contexts (noSendTelegram) and contexts without a chat.
 */
export async function withChatAction<T>(
  ctx: unknown,
  action: string,
  fn: () => Promise<T>,
): Promise<T> {
  const c = ctx as BotContext;
  if (!c?.api || !c?.chat || c.noSendTelegram) return await fn();
  const send = () =>
    c.api
      .sendChatAction(
        c.chat!.id,
        action as Parameters<BotContext["api"]["sendChatAction"]>[1],
        c.businessConnectionId
          ? { business_connection_id: c.businessConnectionId }
          : undefined,
      )
      .catch(() => {}); // indicator is best-effort; never break the wrapped work
  await send();
  const timer = setInterval(() => void send(), CHAT_ACTION_INTERVAL_MS);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}
