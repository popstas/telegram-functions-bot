import { Message } from "telegraf/types";
import { useBot } from "../bot.ts";
import { useApi } from "./useApi.ts";

export async function recognizeImageText(
  msg: Message.PhotoMessage,
): Promise<string> {
  const photo = msg.photo[msg.photo.length - 1];
  const link = await useBot().telegram.getFileLink(photo.file_id);
  const api = useApi();
  try {
    const res = await api.chat.completions.create({
      model: "gpt-4-vision-preview",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Извлеки текст с изображения. Ответь только текстом.",
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
