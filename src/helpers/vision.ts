import { Context } from "telegraf";
import { Message } from "telegraf/types";
import { useBot } from "../bot.ts";
import { llmCall } from "./gpt.ts";
import { useConfig } from "../config.ts";
import { ConfigChatType } from "../types.ts";
import { log } from "../helpers.ts";
import { sendTelegramMessage } from "../telegram/send.ts";
import { createNewContext } from "../telegram/context.ts";
import onTextMessage from "../handlers/onTextMessage.ts";

export async function recognizeImageText(
  fileId: string,
  msg: Message.PhotoMessage | Message.DocumentMessage,
  chatConfig: ConfigChatType,
): Promise<string> {
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
  if ((msg as { caption?: string }).caption)
    prompt = (msg as { caption?: string }).caption!;

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

export async function handleImageMessage(
  ctx: Context,
  msg: Message.PhotoMessage | Message.DocumentMessage,
  fileId: string,
  chat: ConfigChatType,
  mediaType: "photo" | "document",
) {
  const chatTitle = "title" in msg.chat ? msg.chat.title : "private_chat";
  log({
    msg: `[${mediaType}] ${(msg as { caption?: string }).caption || ""}`,
    logLevel: "info",
    chatId: msg.chat.id,
    chatTitle,
    role: "user",
  });

  if ((msg as { caption?: string }).caption?.length > 100) {
    log({
      msg: `[${mediaType}] caption too long, skip ocr: ${
        (msg as { caption: string }).caption.length
      }`,
      logLevel: "info",
      chatId: msg.chat.id,
      chatTitle,
    });

    const newMsg = {
      ...msg,
      text: (msg as { caption: string }).caption,
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

  const process = async () => {
    let text = "";
    try {
      text = await recognizeImageText(fileId, msg, chat);
      text = `Image contents: ${text}`;
    } catch (error) {
      const chatId = ctx.chat?.id || msg.chat?.id;
      try {
        const errText = `Ошибка при распознавании изображения: ${
          error instanceof Error ? error.message : "Неизвестная ошибка"
        }`;
        await sendTelegramMessage(chatId || 0, errText, undefined, ctx, chat);
        return;
      } catch (error) {
        log({
          msg: error instanceof Error ? error.message : "Неизвестная ошибка",
          logLevel: "error",
          chatId,
          chatTitle,
          role: "user",
        });
      }
    }
    const caption = (msg as { caption?: string }).caption
      ? `${(msg as { caption: string }).caption}\n\n`
      : "";

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

  const action = mediaType === "photo" ? "upload_photo" : "upload_document";
  await ctx.persistentChatAction(action, process);
}
