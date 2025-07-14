import OpenAI from "openai";
import { convertResponsesOutput } from "./responsesApi.ts";
import type { ConfigChatType } from "../../types.ts";
import { Message } from "telegraf/types";
import { useBot } from "../../bot.ts";
import { splitBigMessage } from "../../utils/text.ts";

export async function handleResponseStream(
  stream: AsyncIterable<OpenAI.Responses.ResponseStreamEvent>,
  msg: Message.TextMessage,
  chatConfig?: ConfigChatType,
): Promise<{
  res: OpenAI.ChatCompletion;
  webSearchDetails?: string;
  images?: { id?: string; result: string }[];
  sentMessages: Message.TextMessage[];
}> {
  let completed: OpenAI.Responses.Response | undefined;
  const sentMessages: Message.TextMessage[] = [];
  const lastChunks: string[] = [];
  let fullText = "";
  const bot = useBot(chatConfig?.bot_token);

  async function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getRetryAfter(error: unknown) {
    const e = error as {
      response?: { error_code?: number; parameters?: { retry_after?: number } };
    };
    if (e?.response?.error_code === 429 && e.response.parameters?.retry_after) {
      return e.response.parameters.retry_after * 1000;
    }
    return undefined;
  }

  async function safeSend(text: string) {
    for (;;) {
      try {
        return (await bot.telegram.sendMessage(
          msg.chat.id,
          text,
        )) as Message.TextMessage;
      } catch (err) {
        const wait = getRetryAfter(err);
        if (wait) {
          await delay(wait);
          continue;
        }
        console.warn("sendMessage failed", err);
        throw err;
      }
    }
  }

  async function safeEdit(m: Message.TextMessage, text: string) {
    for (;;) {
      try {
        await bot.telegram.editMessageText(
          m.chat.id,
          m.message_id,
          undefined,
          text,
        );
        return;
      } catch (err) {
        const wait = getRetryAfter(err);
        if (wait) {
          await delay(wait);
          continue;
        }
        console.warn("editMessageText failed", err);
        return;
      }
    }
  }

  async function sendChunks(text: string) {
    const chunks = splitBigMessage(text);
    for (let i = 0; i < chunks.length; i++) {
      if (lastChunks[i] === chunks[i]) continue;
      lastChunks[i] = chunks[i];
      if (!sentMessages[i]) {
        sentMessages[i] = await safeSend(chunks[i]);
      } else {
        await safeEdit(sentMessages[i], chunks[i]);
      }
    }
  }

  let flushTimeout: NodeJS.Timeout | undefined;
  let processing = true;

  async function flush() {
    await sendChunks(fullText);
  }

  function scheduleFlush() {
    if (flushTimeout) return;
    flushTimeout = setTimeout(async () => {
      flushTimeout = undefined;
      await flush();
      if (processing) scheduleFlush();
    }, 2000);
  }

  scheduleFlush();

  for await (const event of stream) {
    console.debug("stream event", event.type);
    if (event.type === "response.output_text.delta") {
      const delta = event as OpenAI.Responses.ResponseTextDeltaEvent;
      fullText += delta.delta;
      scheduleFlush();
    } else if (event.type === "response.completed") {
      completed = event.response as OpenAI.Responses.Response;
    }
  }

  processing = false;
  if (flushTimeout) {
    clearTimeout(flushTimeout);
    flushTimeout = undefined;
  }
  await flush();

  if (!completed) {
    throw new Error("No response.completed event received");
  }

  const result = await convertResponsesOutput(completed, {
    sentMessages,
    chatConfig,
  });
  return { ...result, sentMessages };
}
