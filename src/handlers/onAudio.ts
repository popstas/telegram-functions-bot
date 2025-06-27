import { Context } from "telegraf";
import fs from "fs";

import tmp from "tmp";
import onTextMessage from "./onTextMessage.ts";
import checkAccessLevel from "./access.ts";
import { sendTelegramMessage } from "../telegram/send.ts";
import { convertToMp3, sendAudioWhisper } from "../helpers/stt.ts";
import { useConfig } from "../config.ts";
import { log } from "../helpers.ts";
import { Message } from "telegraf/types";

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

export async function processAudio(
  ctx: Context & { secondTry?: boolean },
  voice: { file_id: string },
  chatId: number,
) {
  const link = await ctx.telegram.getFileLink(voice.file_id);
  const oggPath = tmp.tmpNameSync({ postfix: ".ogg" });
  let mp3Path: string | null = null;

  try {
    const response = await fetch(link.href);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    await fs.promises.writeFile(oggPath, Buffer.from(arrayBuffer));

    mp3Path = await convertToMp3(oggPath);
    const res = (await sendAudioWhisper({ mp3Path })) as WhisperResponse;

    if (res.error) {
      await sendTelegramMessage(
        chatId,
        `Ошибка распознавания: ${res.error}`,
        undefined,
        ctx,
      );
      return;
    }

    const text =
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
      "";

    if (!text) {
      await sendTelegramMessage(
        chatId,
        "Не удалось распознать аудио",
        undefined,
        ctx,
      );
      return;
    }

    await sendTelegramMessage(chatId, text, undefined, ctx);

    const fakeMsg = { ...ctx.message, text };
    const newCtx = Object.create(Object.getPrototypeOf(ctx), {
      ...Object.getOwnPropertyDescriptors(ctx),
      message: { value: fakeMsg, writable: true, configurable: true },
      update: {
        value: { ...ctx.update, message: fakeMsg },
        writable: true,
        configurable: true,
      },
    }) as Context & { secondTry?: boolean };
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
    try {
      if (fs.existsSync(oggPath)) fs.unlinkSync(oggPath);
      if (mp3Path && fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
    } catch (cleanupError) {
      console.error("Error cleaning up temporary files:", cleanupError);
    }
  }
}

export default async function onAudio(ctx: Context & { secondTry?: boolean }) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const access = await checkAccessLevel(ctx);
  if (!access) return;
  const { msg: accessMsg } = access;

  if (!useConfig().stt?.whisperBaseUrl) {
    await sendTelegramMessage(
      chatId,
      "Аудио не поддерживается",
      undefined,
      ctx,
    );
    return;
  }
  const msg = accessMsg as unknown as
    | Message.AudioMessage
    | Message.VoiceMessage;
  const chatTitle = "title" in msg.chat ? msg.chat.title : "private_chat";
  const voice =
    (msg as Message.VoiceMessage).voice || (msg as Message.AudioMessage).audio;
  if (!voice) return;

  log({
    msg: `[audio] ${msg.caption || ""}`,
    chatId,
    chatTitle,
    role: "user",
  });

  await ctx.persistentChatAction("typing", async () =>
    processAudio(ctx, voice, chatId),
  );
}
