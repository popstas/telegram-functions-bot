import checkAccessLevel from "./access.ts";
import { Message } from "grammy/types";
import { sendTelegramMessage } from "../telegram/send.ts";
import type { BotContext } from "../telegram/botContext.ts";

type SupportedMediaMessage =
  | Message.VideoMessage
  | Message.VideoNoteMessage
  | Message.DocumentMessage
  | Message.StickerMessage;

export default async function onUnsupported(ctx: BotContext) {
  const access = await checkAccessLevel(ctx);
  if (!access) return;
  const { msg } = access;

  const message = msg as unknown as SupportedMediaMessage;
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
