import fs from "fs";

import tmp from "tmp";
import onTextMessage from "./onTextMessage.ts";
import checkAccessLevel from "./access.ts";
import { sendTelegramMessage } from "../telegram/send.ts";
import { convertToMp3, sendAudioWhisper } from "../helpers/stt.ts";
import { useConfig } from "../config.ts";
import { log } from "../helpers.ts";
import { Message } from "grammy/types";
import { prettyText } from "../utils/text.ts";
import { withChatAction } from "../telegram/chatAction.ts";
import { createNewContext } from "../telegram/context.ts";
import type { BotContext } from "../telegram/botContext.ts";

tmp.setGracefulCleanup();

type WhisperSegment = {
  text?: string;
  start?: number;
  end?: number;
  tokens?: number[];
  temperature?: number;
  avg_logprob?: number;
  compression_ratio?: number;
  no_speech_prob?: number;
};

type WhisperSegmentArray = [number, number, string, string, string];

type WhisperResponse = {
  text?: string;
  error?: string;
  segments?: (WhisperSegment | WhisperSegmentArray)[];
};

/**
 * Расшифровывает голосовое и возвращает текст. Ничего не отправляет в чат:
 * этим пользуется и onAudio (который отправляет сам), и реле (которому нельзя).
 * Любая ошибка это пустая строка. Исключение наружу не летит: вызывающий
 * решает сам, молчать ему или сообщать пользователю.
 */
export async function transcribe(ctx: BotContext, voice: { file_id: string }): Promise<string> {
  const file = await ctx.api.getFile(voice.file_id);
  const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
  const oggPath = tmp.tmpNameSync({ postfix: ".ogg" });
  let mp3Path: string | null = null;

  try {
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    await fs.promises.writeFile(oggPath, Buffer.from(arrayBuffer));

    mp3Path = await convertToMp3(oggPath);

    const res = (await sendAudioWhisper({ mp3Path })) as WhisperResponse;
    if (res.error) {
      console.error("Whisper returned an error:", res.error);
      return "";
    }

    return (
      res.text ||
      res.segments
        ?.map((segment) => {
          if (Array.isArray(segment)) {
            return segment[4];
          } else {
            return segment.text;
          }
        })
        .filter(Boolean)
        .join(" ") ||
      ""
    );
  } catch (error) {
    console.error("Error transcribing audio:", error);
    return "";
  } finally {
    try {
      if (fs.existsSync(oggPath)) fs.unlinkSync(oggPath);
      if (mp3Path && fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
    } catch (cleanupError) {
      console.error("Error cleaning up temporary files:", cleanupError);
    }
  }
}

export async function processAudio(ctx: BotContext, voice: { file_id: string }, chatId: number) {
  const progressTimer: NodeJS.Timeout = setInterval(() => {
    void sendTelegramMessage(chatId, "Распознавание продолжается...", undefined, ctx);
  }, 60_000);

  try {
    const text = await transcribe(ctx, voice);

    if (!text) {
      await sendTelegramMessage(chatId, "Не удалось распознать аудио", undefined, ctx);
      return;
    }

    const paragraphs = prettyText(text);
    // Blockquote so the recognized text reads as a quote of the voice message.
    const quoted = paragraphs
      .split("\n")
      .map((line) => `> ${line}`.trimEnd())
      .join("\n");
    await sendTelegramMessage(chatId, quoted, undefined, ctx);

    const fakeMsg = { ...ctx.message, text } as Message;
    const newCtx = createNewContext(ctx, fakeMsg);
    await onTextMessage(newCtx);
  } catch (error) {
    console.error("Error processing audio:", error);
    await sendTelegramMessage(
      chatId,
      "Произошла ошибка при обработке аудио. Пожалуйста, попробуйте еще раз.",
      undefined,
      ctx,
    );
  } finally {
    clearInterval(progressTimer);
  }
}

export default async function onAudio(ctx: BotContext) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const access = await checkAccessLevel(ctx);
  if (!access) return;
  const { msg: accessMsg } = access;

  if (!useConfig().stt?.whisperBaseUrl) {
    await sendTelegramMessage(chatId, "Аудио не поддерживается", undefined, ctx);
    return;
  }
  const msg = accessMsg as unknown as Message.AudioMessage | Message.VoiceMessage;
  const chatTitle = "title" in msg.chat ? msg.chat.title : "private_chat";
  const voice = (msg as Message.VoiceMessage).voice || (msg as Message.AudioMessage).audio;
  if (!voice) return;

  log({
    msg: `[audio] ${msg.caption || ""}`,
    chatId,
    chatTitle,
    role: "user",
  });

  await withChatAction(ctx, "typing", async () => processAudio(ctx, voice, chatId));
}
