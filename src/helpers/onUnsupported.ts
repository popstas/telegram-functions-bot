import { Context } from "telegraf";
import { Message } from "telegraf/types";
import { sendTelegramMessage } from "./telegram.ts";

export default async function onUnsupported(ctx: Context) {
  const msg = ctx.message as Message.AudioMessage | Message.VoiceMessage;
  if (!msg) return;
  await sendTelegramMessage(
    msg.chat.id,
    "Извините, обработка аудио не поддерживается",
    {},
    ctx,
  );
}
