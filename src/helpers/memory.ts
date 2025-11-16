import type { ConfigChatType } from "../types.ts";
import type { Message } from "telegraf/types";
import { saveEmbedding } from "./embeddings.ts";

export function isRememberCommand(text: string): boolean {
  return text.toLowerCase().startsWith("запомни");
}

export function stripRememberPrefix(text: string): string {
  return text.replace(/^запомни[\s\p{P}]*/iu, "");
}

export async function rememberSave(params: {
  text: string;
  msg?: Message.TextMessage;
  chat: ConfigChatType;
}): Promise<string> {
  const { text, msg, chat } = params;
  await saveEmbedding({
    text,
    metadata: {
      chatId: msg?.chat.id,
      userId: msg?.from?.id,
      messageId: msg?.message_id,
    },
    chat,
  });
  return "Запомнил";
}
