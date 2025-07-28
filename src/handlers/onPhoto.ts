import { Context } from "telegraf";
import { Message, Update } from "telegraf/types";
import onTextMessage from "./onTextMessage.ts";
import checkAccessLevel from "./access.ts";
import { recognizeImageText } from "../helpers/vision.ts";
import { log } from "../helpers";
import { useConfig } from "../config.ts";
import { sendTelegramMessage } from "../telegram/send.ts";
import { createNewContext } from "../telegram/context.ts";

// Type guard to check if update has a message
function isMessageUpdate(update: Update): update is Update.MessageUpdate {
  return "message" in update;
}

export default async function onPhoto(ctx: Context) {
  if (!("message" in ctx.update) || !isMessageUpdate(ctx.update)) {
    return; // Not a message update
  }

  const access = await checkAccessLevel(ctx);
  if (!access) return;

  const { msg: accessMsg, chat } = access;
  const msg = accessMsg as unknown as Message.PhotoMessage;
  if (!msg.photo?.length) return;
  const chatTitle = "title" in msg.chat ? msg.chat.title : "private_chat";
  log({
    msg: `[photo] ${msg.caption || ""}`,
    logLevel: "info",
    chatId: msg.chat.id,
    chatTitle,
    role: "user",
  });

  if (msg.caption && msg.caption.length > 100) {
    log({
      msg: `[photo] caption too long, skip ocr: ${msg.caption.length}`,
      logLevel: "info",
      chatId: msg.chat.id,
      chatTitle,
    });

    const newMsg = {
      ...msg,
      text: msg.caption,
      entities: [],
    } as const;

    const contextWithCaption = createNewContext(ctx, newMsg);

    await onTextMessage(contextWithCaption);
    return;
  }

  const config = useConfig();
  const model = config?.vision?.model || "";
  if (!model)
    return await sendTelegramMessage(
      msg.chat.id,
      "Извините, обработка изображений не поддерживается",
    );

  // Create a new message object with the recognized text
  const processPhoto = async () => {
    let text = "";
    try {
      text = await recognizeImageText(msg, chat);
    } catch (error) {
      const chatId = ctx.chat?.id || msg.chat?.id || ctx.from?.id;
      try {
        await sendTelegramMessage(
          chatId || 0,
          `Ошибка при распознавании текста: ${error instanceof Error ? error.message : "Неизвестная ошибка"}`,
        );
      } catch (error) {
        log({
          msg: error instanceof Error ? error.message : 'Неизвестная ошибка',
          logLevel: "error",
          chatId,
          chatTitle,
          role: "user",
        });
      }
    }
    const caption = msg.caption ? `${msg.caption}\n` : "";

    log({
      msg: text,
      logLevel: "info",
      chatId: msg.chat.id,
      chatTitle,
      role: "user",
    });

    // Create a new message object with the recognized text
    const newMsg = {
      ...msg,
      text: caption + text,
      entities: [],
    } as const;

    // Create a new context by extending the original context
    const contextWithNewMessage = createNewContext(ctx, newMsg);

    await onTextMessage(contextWithNewMessage);
  };

  // Use the original context for persistentChatAction
  await ctx.persistentChatAction("upload_photo", processPhoto);
}
