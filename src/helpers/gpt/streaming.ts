import OpenAI from "openai";
import { convertResponsesOutput } from "./responsesApi.ts";
import type { ConfigChatType } from "../../types.ts";
import { Message } from "telegraf/types";
import { useBot } from "../../bot.ts";
import { splitBigMessage } from "../../utils/text.ts";
import telegramifyMarkdown from "telegramify-markdown";

export function getRetryAfter(error: unknown) {
  const e = error as {
    response?: { error_code?: number; parameters?: { retry_after?: number } };
  };
  if (e?.response?.error_code === 429 && e.response.parameters?.retry_after) {
    return e.response.parameters.retry_after * 1000;
  }
  return undefined;
}

export async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function safeSend(
  bot: ReturnType<typeof useBot>,
  chatId: number | string,
  text: string,
): Promise<Message.TextMessage> {
  for (;;) {
    try {
      return (await bot.telegram.sendMessage(
        chatId,
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

export async function safeEdit(
  bot: ReturnType<typeof useBot>,
  m: Message.TextMessage,
  text: string,
): Promise<void> {
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

export async function safeDelete(
  bot: ReturnType<typeof useBot>,
  m: Message.TextMessage,
): Promise<void> {
  for (;;) {
    try {
      await bot.telegram.deleteMessage(m.chat.id, m.message_id);
      return;
    } catch (err) {
      const wait = getRetryAfter(err);
      if (wait) {
        await delay(wait);
        continue;
      }
      console.warn("deleteMessage failed", err);
      return;
    }
  }
}

function createFlusher(
  bot: ReturnType<typeof useBot>,
  msg: Message.TextMessage,
) {
  const sentMessages: Message.TextMessage[] = [];
  const lastChunks: string[] = [];
  let fullText = "";
  let flushTimeout: NodeJS.Timeout | undefined;
  let processing = true;

  async function sendChunks(text: string) {
    const chunks = splitBigMessage(text);
    for (let i = 0; i < chunks.length; i++) {
      if (lastChunks[i] === chunks[i]) continue;
      lastChunks[i] = chunks[i];
      if (!sentMessages[i]) {
        sentMessages[i] = await safeSend(bot, msg.chat.id, chunks[i]);
      } else {
        await safeEdit(bot, sentMessages[i], chunks[i]);
      }
    }
  }

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

  function add(delta: string) {
    fullText += delta;
    scheduleFlush();
  }

  async function finish() {
    processing = false;
    if (flushTimeout) {
      clearTimeout(flushTimeout);
      flushTimeout = undefined;
    }
    await flush();
    return { fullText, sentMessages } as const;
  }

  return { add, finish, sentMessages } as const;
}

export async function handleStream<T, R>(
  stream: AsyncIterable<T>,
  msg: Message.TextMessage,
  chatConfig: ConfigChatType | undefined,
  callbacks: {
    extractDelta(chunk: T): string | undefined;
    onChunk?(chunk: T): void;
    finalize(
      fullText: string,
      helpers: {
        sentMessages: Message.TextMessage[];
        safeEdit: (m: Message.TextMessage, t: string) => Promise<void>;
        safeDelete: (m: Message.TextMessage) => Promise<void>;
      },
    ): Promise<R>;
  },
): Promise<R & { sentMessages: Message.TextMessage[] }> {
  const bot = useBot(chatConfig?.bot_token);
  const flusher = createFlusher(bot, msg);

  for await (const chunk of stream) {
    callbacks.onChunk?.(chunk);
    const delta = callbacks.extractDelta(chunk);
    if (delta) flusher.add(delta);
  }

  const { fullText, sentMessages } = await flusher.finish();

  const res = await callbacks.finalize(fullText, {
    sentMessages,
    safeEdit: (m, t) => safeEdit(bot, m, t),
    safeDelete: (m) => safeDelete(bot, m),
  });

  return { ...res, sentMessages };
}

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

  return handleStream(stream, msg, chatConfig, {
    extractDelta(chunk) {
      return chunk.type === "response.output_text.delta"
        ? (chunk as OpenAI.Responses.ResponseTextDeltaEvent).delta
        : undefined;
    },
    onChunk(chunk) {
      if (chunk.type === "response.completed") {
        completed = (chunk as OpenAI.Responses.ResponseCompletedEvent).response;
      }
    },
    async finalize(_fullText, helpers) {
      if (!completed) {
        throw new Error("No response.completed event received");
      }
      const result = await convertResponsesOutput(completed);
      const finalOutput = result.res.choices?.[0]?.message?.content ?? "";
      const processed = telegramifyMarkdown(finalOutput, "escape");
      const chunks = splitBigMessage(processed);
      for (let i = 0; i < chunks.length; i++) {
        if (helpers.sentMessages[i]) {
          await helpers.safeEdit(helpers.sentMessages[i], chunks[i]);
        }
      }
      for (const m of helpers.sentMessages) {
        await helpers.safeDelete(m);
      }
      helpers.sentMessages.length = 0;
      return result;
    },
  });
}

import type { ChatCompletionStream } from "openai/lib/ChatCompletionStream.js";
import type { ChatCompletionChunk } from "openai/resources/chat/completions/index.js";

export async function handleCompletionStream(
  stream: ChatCompletionStream,
  msg: Message.TextMessage,
  chatConfig?: ConfigChatType,
): Promise<{
  res: OpenAI.ChatCompletion;
  sentMessages: Message.TextMessage[];
}> {
  return handleStream(stream, msg, chatConfig, {
    extractDelta(chunk: ChatCompletionChunk) {
      return chunk.choices?.[0]?.delta?.content ?? undefined;
    },
    async finalize(fullText, helpers) {
      let res: OpenAI.ChatCompletion;
      let finalOutput = "";
      const withFinalCC = stream as unknown as {
        finalChatCompletion?: () => Promise<OpenAI.ChatCompletion>;
        finalMessage?: () => Promise<OpenAI.ChatCompletionMessageParam>;
        finalContent?: () => Promise<string | null | undefined>;
      };
      if (typeof withFinalCC.finalChatCompletion === "function") {
        res = await withFinalCC.finalChatCompletion();
        finalOutput = res.choices?.[0]?.message?.content ?? "";
      } else if (typeof withFinalCC.finalMessage === "function") {
        const message = await withFinalCC.finalMessage();
        res = { choices: [{ index: 0, message }] } as OpenAI.ChatCompletion;
        finalOutput =
          typeof message?.content === "string" ? message.content : "";
      } else if (typeof withFinalCC.finalContent === "function") {
        const content = await withFinalCC.finalContent();
        res = {
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: content ?? "" },
            } as OpenAI.ChatCompletion.Choice,
          ],
        } as OpenAI.ChatCompletion;
        finalOutput = typeof content === "string" ? content : "";
      } else {
        res = {
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: fullText },
            } as OpenAI.ChatCompletion.Choice,
          ],
        } as OpenAI.ChatCompletion;
        finalOutput = fullText;
      }

      const processed = telegramifyMarkdown(finalOutput, "escape");
      const chunks = splitBigMessage(processed);
      for (let i = 0; i < chunks.length; i++) {
        if (helpers.sentMessages[i]) {
          await helpers.safeEdit(helpers.sentMessages[i], chunks[i]);
        }
      }
      for (const m of helpers.sentMessages) {
        await helpers.safeDelete(m);
      }
      helpers.sentMessages.length = 0;

      return { res };
    },
  });
}
