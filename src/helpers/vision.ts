import { Message } from "telegraf/types";
import { useBot } from "../bot.ts";
import { useApi } from "./useApi.ts";
import { useConfig } from "../config.ts";

export async function recognizeImageText(
  msg: Message.PhotoMessage,
): Promise<string> {
  const photo = msg.photo[msg.photo.length - 1];
  const link = await useBot().telegram.getFileLink(photo.file_id);
  const api = useApi();
  const config = useConfig();
  const model = config?.vision?.model || "";
  if (!model) return "";

  let prompt = "Извлеки текст с изображения. Ответь только текстом.";
  if (msg.caption) prompt = msg.caption;

  try {
    const res = await api.chat.completions.create({
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
    });
    return res.choices[0]?.message?.content?.trim() || "";
  } catch (e) {
    console.error("vision error", e);
    return "";
  }
}
