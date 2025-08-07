import FormData from "form-data";
import fs from "fs";

type LanguageData = {
  detected_language: string;
};
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

  try {
    // Verify file exists and is readable
    await fs.promises.access(mp3Path, fs.constants.R_OK);
    const fileBuffer = await fs.promises.readFile(mp3Path);
    const formData = new FormData();
    formData.append("audio_file", fileBuffer, {
      filename: "audio.mp3",
      contentType: "audio/mpeg",
      knownLength: fileBuffer.length,
    });

    const headers = {
      ...formData.getHeaders(),
      Accept: "application/json",
    };

    const response = await fetch(`${baseUrl}/detect-language`, {
      method: "POST",
      body: formData.getBuffer(),
      headers: headers as Record<string, string>,
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error("Error response:", {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: responseText,
      });
      throw new Error(`HTTP error! status: ${response.status}, body: ${responseText}`);
    }

    try {
      return JSON.parse(responseText);
    } catch {
      console.error("Failed to parse JSON response:", responseText);
      throw new Error(`Invalid JSON response: ${responseText}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("ENOENT")) {
        throw new Error(`Audio file not found: ${mp3Path}`);
      } else if (error.message.includes("EACCES")) {
        throw new Error(`No permission to read audio file: ${mp3Path}`);
      }
    }
    throw error;
  }
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

  const languageData = (await detectAudioFileLanguage(mp3Path)) as LanguageData;
  const fileBuffer = await fs.promises.readFile(mp3Path);

  const formData = new FormData();
  formData.append("audio_file", fileBuffer, {
    filename: "audio.mp3",
    contentType: "audio/mpeg",
    knownLength: fileBuffer.length,
  });
  formData.append("task", "transcribe");
  formData.append("language", languageData.detected_language);

  const headers = {
    ...formData.getHeaders(),
    Accept: "application/json",
  };

  const url = `${baseUrl}/asr?output=json&word_timestamps=true&vad_filter=1&initial_prompt=${encodeURIComponent(prompt)}`;

  const response = await fetch(url, {
    method: "POST",
    body: formData.getBuffer(),
    headers: headers as Record<string, string>,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
  }

  return await response.json();
}
