import { Context } from "telegraf";
import { Message } from "telegraf/types";
import { useBot } from "../bot.ts";
import { llmCall } from "./gpt.ts";
import { useConfig } from "../config.ts";
import { ConfigChatType } from "../types.ts";
import { sendTelegramMessage } from "../telegram/send.ts";
import { createNewContext } from "../telegram/context.ts";
import { log } from "../helpers.ts";
import onTextMessage from "../handlers/onTextMessage.ts";

export type ImageMessage = Message.PhotoMessage | Message.DocumentMessage;

export async function recognizeImageText(
  msg: ImageMessage,
  chatConfig: ConfigChatType,
): Promise<string> {
  let fileId: string;
  if ("photo" in msg && msg.photo?.length) {
    fileId = msg.photo[msg.photo.length - 1].file_id;
  } else if ("document" in msg && msg.document) {
    fileId = msg.document.file_id;
  } else {
    throw new Error("Не удалось получить изображение.");
  }

  let link;
  try {
    link = await useBot(chatConfig.bot_token).telegram.getFileLink(fileId);
  } catch (error) {
    const err = error as Error;
    if (
      err.message.includes("wrong file_id") ||
      err.message.includes("temporarily unavailable")
    ) {
      throw new Error("Не удалось получить изображение.");
    }
    throw error;
  }

  const config = useConfig();
  const model = config?.vision?.model || "";
  if (!model) throw new Error("Не указана модель для распознавания.");

  let prompt = "Извлеки текст с изображения. Ответь только текстом.";
  if (msg.caption) prompt = msg.caption;

  try {
    const { res } = await llmCall({
      generationName: "llm-vision",
      apiParams: {
        model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: prompt,
              },
              { type: "image_url", image_url: { url: link.toString() } },
            ],
          },
        ],
      },
      msg: msg as unknown as Message.TextMessage,
      chatConfig,
      noSendTelegram: true,
    });
    return res.choices[0]?.message?.content?.trim() || "";
  } catch (e) {
    console.error("vision error", e);
    throw e;
  }
}

export async function processImageMessage(
  ctx: Context,
  msg: ImageMessage,
  chat: ConfigChatType,
  uploadAction: "upload_photo" | "upload_document",
) {
  const config = useConfig();
  const model = config?.vision?.model || "";
  if (!model)
    return await sendTelegramMessage(
      msg.chat.id,
      "Извините, обработка изображений не поддерживается",
    );

  const chatTitle = "title" in msg.chat ? msg.chat.title : "private_chat";

  const run = async () => {
    let text = "";
    try {
      text = await recognizeImageText(msg, chat);
      text = `Image contents: ${text}`;
    } catch (error) {
      const chatId = ctx.chat?.id || msg.chat?.id;
      try {
        const errText = `Ошибка при распознавании изображения: ${
          error instanceof Error ? error.message : "Неизвестная ошибка"
        }`;
        await sendTelegramMessage(chatId || 0, errText, undefined, ctx, chat);
        return;
      } catch (error2) {
        log({
          msg: error2 instanceof Error ? error2.message : "Неизвестная ошибка",
          logLevel: "error",
          chatId,
          chatTitle,
          role: "user",
        });
      }
    }

    const caption = msg.caption ? `${msg.caption}\n\n` : "";

    log({
      msg: text,
      logLevel: "info",
      chatId: msg.chat.id,
      chatTitle,
      role: "user",
    });

    const newMsg = {
      ...msg,
      text: caption + text,
      entities: [],
    } as const;

    const contextWithNewMessage = createNewContext(ctx, newMsg);

    await onTextMessage(contextWithNewMessage);
  };

  await ctx.persistentChatAction(uploadAction, run);
}
