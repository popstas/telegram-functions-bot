import OpenAI from "openai";
import { log } from "../../helpers.ts";
import { convertResponsesOutput } from "./responsesApi.ts";
import type { ConfigChatType } from "../../types.ts";
import { Message } from "telegraf/types";
import { useBot } from "../../bot.ts";
import { splitBigMessage } from "../../utils/text.ts";

export async function handleResponseStream(
  stream: AsyncIterable<{
    type: string;
    response?: unknown;
    snapshot?: string;
  }>,
  msg: Message.TextMessage,
  chatConfig?: ConfigChatType,
): Promise<{
  res: OpenAI.ChatCompletion;
  webSearchDetails?: string;
  images?: { id?: string; result: string }[];
}> {
  let completed: OpenAI.Responses.Response | undefined;
  let sentMessage: Message.TextMessage | undefined;
  let lastText = "";
  for await (const event of stream) {
    log({
      msg: `responses event: ${event.type}`,
      chatId: chatConfig?.id,
      chatTitle: chatConfig?.name,
      logLevel: "debug",
    });
    if (event.type === "response.output_text.delta" && event.snapshot) {
      const text = event.snapshot as string;
      // Skip duplicate updates
      if (text === lastText) continue;
      lastText = text;
      const msgs = splitBigMessage(text);
      const processed = msgs[0];
      if (!sentMessage) {
        try {
          sentMessage = await useBot(
            chatConfig?.bot_token,
          ).telegram.sendMessage(msg.chat.id, processed);
        } catch (e) {
          log({
            msg: `sendMessage failed: ${(e as Error).message}`,
            chatId: chatConfig?.id,
            logLevel: "warn",
          });
        }
      } else {
        try {
          await useBot(chatConfig?.bot_token).telegram.editMessageText(
            sentMessage.chat.id,
            sentMessage.message_id,
            undefined,
            processed,
          );
        } catch (e) {
          log({
            msg: `editMessageText failed: ${(e as Error).message}`,
            chatId: chatConfig?.id,
            logLevel: "warn",
          });
        }
      }
    } else if (event.type === "response.completed") {
      log({
        msg: `response.completed`,
        chatId: chatConfig?.id,
        chatTitle: chatConfig?.name,
        logLevel: "verbose",
      });
      completed = event.response as OpenAI.Responses.Response;
    }
  }

  if (!completed) {
    throw new Error("No response.completed event received");
  }

  return convertResponsesOutput(completed);
}
