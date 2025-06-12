import { Message } from "telegraf/types";
import { useBot } from "../bot.ts";
import { llmCall } from "./gpt.ts";
import { useConfig } from "../config.ts";
import { ConfigChatType } from "../types.ts";

export async function recognizeImageText(
  msg: Message.PhotoMessage,
  chatConfig: ConfigChatType,
): Promise<string> {
  const photo = msg.photo[msg.photo.length - 1];
  const link = await useBot().telegram.getFileLink(photo.file_id);

  const config = useConfig();
  const model = config?.vision?.model || "";
  if (!model) return "";

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
    });
    return res.choices[0]?.message?.content?.trim() || "";
  } catch (e) {
    console.error("vision error", e);
    return "";
  }
}
