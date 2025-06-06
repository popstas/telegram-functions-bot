import { Context } from "telegraf";
import { Message } from "telegraf/types";
import { sendTelegramMessage } from "./telegram.ts";

type SupportedMediaMessage =
  | Message.VideoMessage
  | Message.VideoNoteMessage
  | Message.DocumentMessage
  | Message.StickerMessage;

export default async function onUnsupported(ctx: Context) {
  if (!ctx.message) return;

  const message = ctx.message as SupportedMediaMessage;
  const messageTypes = {
    video: "видео",
    video_note: "видео",
    document: "документов",
    sticker: "стикеров",
  };

  let messageType = "";
  for (const [key, value] of Object.entries(messageTypes)) {
    if (key in message) {
      messageType = value;
      break;
    }
  }
  if (!messageType) messageType = "неизвестного типа";
  await sendTelegramMessage(
    message.chat.id,
    `Извините, обработка ${messageType} не поддерживается`,
    {},
    ctx,
  );
}
