import { Context } from "telegraf";
import fs from "fs";
import axios from "axios";
import tmp from "tmp";
import onMessage from "./onMessage.ts";
import { sendTelegramMessage } from "./telegram.ts";
import { convertToMp3, sendAudioWhisper } from "./stt.ts";
import { useConfig } from "../config.ts";

tmp.setGracefulCleanup();

export default async function onAudio(ctx: Context & { secondTry?: boolean }) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  if (!useConfig().stt?.whisperBaseUrl) {
    await sendTelegramMessage(
      chatId,
      "Аудио не поддерживается",
      undefined,
      ctx,
    );
    return;
  }

  // @ts-ignore
  const voice = ctx.message?.voice || ctx.message?.audio;
  if (!voice) return;

  const link = await ctx.telegram.getFileLink(voice.file_id);
  const oggPath = tmp.tmpNameSync({ postfix: ".ogg" });
  const resp = await axios.get(link.href, { responseType: "stream" });
  await new Promise((resolve, reject) => {
    const w = fs.createWriteStream(oggPath);
    resp.data.pipe(w);
    w.on("finish", resolve);
    w.on("error", reject);
  });

  const mp3Path = await convertToMp3(oggPath);
  const res = await sendAudioWhisper({ mp3Path });
  fs.unlinkSync(oggPath);
  fs.unlinkSync(mp3Path);

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
    res.segments?.map((s: any) => (Array.isArray(s) ? s[4] : s.text)).join(" ");
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

  const fakeMsg = { ...ctx.message, text } as any;
  const newCtx = {
    ...ctx,
    message: fakeMsg,
    update: { ...ctx.update, message: fakeMsg },
  } as Context & { secondTry?: boolean };
  await onMessage(newCtx);
}
