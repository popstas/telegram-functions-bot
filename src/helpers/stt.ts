import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import tmp from "tmp";
import { exec as execCb } from "child_process";
import { promisify } from "util";
import { useConfig } from "../config.ts";

const exec = promisify(execCb);

tmp.setGracefulCleanup();

export async function convertToMp3(inputPath: string): Promise<string> {
  const tmpFile = tmp.tmpNameSync({ postfix: ".mp3" });
  await exec(`ffmpeg -y -i "${inputPath}" -ac 1 -loglevel error "${tmpFile}"`);
  return tmpFile;
}

export async function detectAudioFileLanguage(mp3Path: string) {
  const baseUrl = useConfig().stt?.whisperBaseUrl;
  if (!baseUrl) throw new Error("whisperBaseUrl not defined");
  const formData = new FormData();
  formData.append("audio_file", fs.createReadStream(mp3Path));
  const res = await axios.post(`${baseUrl}/detect-language`, formData, {
    headers: formData.getHeaders(),
  });
  return res.data;
}

export async function sendAudioWhisper({
  mp3Path,
  prompt = "",
}: {
  mp3Path: string;
  prompt?: string;
}) {
  const baseUrl = useConfig().stt?.whisperBaseUrl;
  if (!baseUrl) throw new Error("whisperBaseUrl not defined");

  const languageData = await detectAudioFileLanguage(mp3Path);
  const formData = new FormData();
  formData.append("audio_file", fs.createReadStream(mp3Path));
  formData.append("task", "transcribe");
  formData.append("language", languageData.detected_language);
  const res = await axios.post(
    `${baseUrl}/asr?output=json&word_timestamps=true&vad_filter=1&initial_prompt=${encodeURIComponent(prompt)}`,
    formData,
    { headers: formData.getHeaders() },
  );
  return res.data;
}
