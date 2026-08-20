import { useConfig } from "../config.ts";

/**
 * Resolve a config recipient to a Telegram chat id.
 * Accepts a numeric id, a numeric string, or the `name`/`username` of a chat from `config.chats`.
 * Returns undefined when a named recipient is not found in the config.
 */
export function resolveRecipientChatId(recipient: string | number): number | undefined {
  if (typeof recipient === "number") return recipient;

  const trimmed = recipient.trim();
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);

  const username = trimmed.replace(/^@/, "");
  const chat = useConfig().chats.find((c) => c.username === username || c.name === trimmed);
  return chat?.id;
}
