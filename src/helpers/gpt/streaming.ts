import OpenAI from "openai";
import { convertResponsesOutput } from "./responsesApi.ts";
import type { ConfigChatType } from "../../types.ts";
import { Message } from "grammy/types";
import { useBot } from "../../bot.ts";
import { splitBigMessage } from "../../utils/text.ts";
import telegramifyMarkdown from "telegramify-markdown";
import { getRetryAfterMs } from "../../telegram/errors.ts";

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
      return (await bot.telegram.sendMessage(chatId, text)) as Message.TextMessage;
    } catch (err) {
      const wait = getRetryAfterMs(err);
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
      await bot.telegram.editMessageText(m.chat.id, m.message_id, undefined, text);
      return;
    } catch (err) {
      const wait = getRetryAfterMs(err);
      if (wait) {
        await delay(wait);
        continue;
      }
      console.warn("editMessageText failed", err);
      return;
    }
  }
}

export async function safeSendDraft(
  bot: ReturnType<typeof useBot>,
  chatId: number | string,
  text: string,
  messageThreadId?: number,
): Promise<void> {
  const api = (
    bot.telegram as unknown as {
      callApi: (method: string, payload: Record<string, unknown>) => Promise<unknown>;
    }
  ).callApi;
  for (;;) {
    try {
      await api.call(bot.telegram, "sendMessageDraft", {
        chat_id: chatId,
        text,
        ...(messageThreadId !== undefined ? { message_thread_id: messageThreadId } : {}),
      });
      return;
    } catch (err) {
      const wait = getRetryAfterMs(err);
      if (wait) {
        await delay(wait);
        continue;
      }
      console.warn("sendMessageDraft failed", err);
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
      const wait = getRetryAfterMs(err);
      if (wait) {
        await delay(wait);
        continue;
      }
      console.warn("deleteMessage failed", err);
      return;
    }
  }
}

function createFlusher(bot: ReturnType<typeof useBot>, msg: Message.TextMessage) {
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
    // await flush();
    return { fullText, sentMessages } as const;
  }

  return { add, finish, sentMessages } as const;
}

export function createDraftFlusher(bot: ReturnType<typeof useBot>, msg: Message.TextMessage) {
  const sentMessages: Message.TextMessage[] = [];
  let fullText = "";
  let flushTimeout: NodeJS.Timeout | undefined;
  let processing = true;
  // Promise for an in-flight flush (which may be sleeping on a 429 retry inside
  // safeSendDraft). finish() must await it before clearing, otherwise a late
  // flush can write stale text back over the cleared draft.
  let activeFlush: Promise<void> | undefined;
  const messageThreadId = (msg as { message_thread_id?: number }).message_thread_id;

  async function flush() {
    await safeSendDraft(bot, msg.chat.id, fullText, messageThreadId);
  }

  function scheduleFlush() {
    if (flushTimeout) return;
    flushTimeout = setTimeout(async () => {
      flushTimeout = undefined;
      activeFlush = flush();
      try {
        await activeFlush;
      } finally {
        activeFlush = undefined;
      }
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
    // Wait for any in-flight flush to settle so it cannot overwrite the clear below.
    if (activeFlush) await activeFlush;
    // Clear the ephemeral draft; the persisted final answer is sent by the normal send path.
    await safeSendDraft(bot, msg.chat.id, "", messageThreadId);
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
    extractToolCalls?(chunk: T):
      | {
          index: number;
          id?: string;
          function?: { arguments?: string; name?: string };
          type?: string;
        }[]
      | undefined;
    onChunk?(chunk: T): void;
    finalize(
      fullText: string,
      helpers: {
        sentMessages: Message.TextMessage[];
        safeEdit: (m: Message.TextMessage, t: string) => Promise<void>;
        safeDelete: (m: Message.TextMessage) => Promise<void>;
      },
      toolCalls: {
        index: number;
        id?: string;
        function: { arguments: string; name?: string };
        type?: string;
      }[],
    ): Promise<R>;
  },
): Promise<R & { sentMessages: Message.TextMessage[] }> {
  const bot = useBot(chatConfig?.bot_token);
  const useDraft = chatConfig?.chatParams?.streamMode === "draft";
  const flusher = useDraft ? createDraftFlusher(bot, msg) : createFlusher(bot, msg);
  const finalToolCalls: Record<
    number,
    {
      index: number;
      id?: string;
      function: { arguments: string; name?: string };
      type?: string;
    }
  > = {};

  for await (const chunk of stream) {
    callbacks.onChunk?.(chunk);
    const delta = callbacks.extractDelta(chunk);
    if (delta) flusher.add(delta);
    const toolCalls = callbacks.extractToolCalls?.(chunk) || [];
    for (const toolCall of toolCalls) {
      const { index } = toolCall;
      if (!finalToolCalls[index]) {
        finalToolCalls[index] = {
          index,
          id: toolCall.id,
          type: toolCall.type,
          function: { arguments: "", name: toolCall.function?.name },
        };
      }
      const acc = finalToolCalls[index];
      if (toolCall.id) acc.id = toolCall.id;
      if (toolCall.type) acc.type = toolCall.type;
      if (toolCall.function?.name) acc.function.name = toolCall.function.name;
      if (toolCall.function?.arguments) acc.function.arguments += toolCall.function.arguments;
    }
  }

  const { fullText, sentMessages } = await flusher.finish();

  const res = await callbacks.finalize(
    fullText,
    {
      sentMessages,
      safeEdit: (m, t) => safeEdit(bot, m, t),
      safeDelete: (m) => safeDelete(bot, m),
    },
    Object.values(finalToolCalls),
  );

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
  if (chatConfig?.chatParams?.responseButtons) {
    let completed: OpenAI.Responses.Response | undefined;
    for await (const chunk of stream) {
      if (chunk.type === "response.completed") {
        completed = (chunk as OpenAI.Responses.ResponseCompletedEvent).response;
      }
    }
    if (!completed) {
      throw new Error("No response.completed event received");
    }
    const result = await convertResponsesOutput(completed);
    return { ...result, sentMessages: [] };
  }

  let completed: OpenAI.Responses.Response | undefined;

  return handleStream(stream, msg, chatConfig, {
    extractDelta(chunk) {
      return chunk.type === "response.output_text.delta"
        ? (chunk as OpenAI.Responses.ResponseTextDeltaEvent).delta
        : undefined;
    },
    extractToolCalls(chunk) {
      return chunk.type === "response.function_call_arguments.delta"
        ? [
            {
              index: chunk.output_index,
              id: chunk.item_id,
              type: "function",
              function: {
                arguments: (chunk as OpenAI.Responses.ResponseFunctionCallArgumentsDeltaEvent)
                  .delta,
              },
            },
          ]
        : chunk.type === "response.output_item.added" && chunk.item.type === "function_call"
          ? [
              {
                index: chunk.output_index,
                id: chunk.item.id,
                type: "function",
                function: {
                  name: chunk.item.name,
                  arguments: chunk.item.arguments ?? "",
                },
              },
            ]
          : [];
    },
    onChunk(chunk) {
      if (chunk.type === "response.completed") {
        completed = (chunk as OpenAI.Responses.ResponseCompletedEvent).response;
      }
    },
    async finalize(_fullText, helpers, toolCalls) {
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
      if (!result.res.choices[0].message.tool_calls?.length && toolCalls.length) {
        (result.res.choices[0].message as OpenAI.ChatCompletionAssistantMessageParam).tool_calls =
          toolCalls as OpenAI.ChatCompletionMessageToolCall[];
      }
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
  if (chatConfig?.chatParams?.responseButtons) {
    let fullText = "";
    const finalToolCalls: Record<
      number,
      {
        index: number;
        id?: string;
        function: { arguments: string; name?: string };
        type?: string;
      }
    > = {};
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) fullText += delta.content;
      for (const toolCall of delta?.tool_calls || []) {
        const { index } = toolCall;
        if (!finalToolCalls[index]) {
          finalToolCalls[index] = {
            index,
            id: toolCall.id,
            type: toolCall.type,
            function: { arguments: "", name: toolCall.function?.name },
          };
        }
        const acc = finalToolCalls[index];
        if (toolCall.id) acc.id = toolCall.id;
        if (toolCall.type) acc.type = toolCall.type;
        if (toolCall.function?.name) acc.function.name = toolCall.function.name;
        if (toolCall.function?.arguments) acc.function.arguments += toolCall.function.arguments;
      }
    }
    let res: OpenAI.ChatCompletion;
    const withFinalCC = stream as unknown as {
      finalChatCompletion?: () => Promise<OpenAI.ChatCompletion>;
      finalMessage?: () => Promise<OpenAI.ChatCompletionMessageParam>;
      finalContent?: () => Promise<string | null | undefined>;
    };
    if (typeof withFinalCC.finalChatCompletion === "function") {
      res = await withFinalCC.finalChatCompletion();
    } else if (typeof withFinalCC.finalMessage === "function") {
      const message = await withFinalCC.finalMessage();
      res = { choices: [{ index: 0, message }] } as OpenAI.ChatCompletion;
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
    } else {
      res = {
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: fullText,
              tool_calls: Object.keys(finalToolCalls).length
                ? (Object.values(
                    finalToolCalls,
                  ) as unknown as OpenAI.ChatCompletionMessageToolCall[])
                : undefined,
            } as OpenAI.ChatCompletionAssistantMessageParam,
          } as OpenAI.ChatCompletion.Choice,
        ],
      } as OpenAI.ChatCompletion;
    }
    if (!res.choices[0].message.tool_calls?.length && Object.keys(finalToolCalls).length) {
      (res.choices[0].message as OpenAI.ChatCompletionAssistantMessageParam).tool_calls =
        Object.values(finalToolCalls) as OpenAI.ChatCompletionMessageToolCall[];
    }
    return { res, sentMessages: [] };
  }

  return handleStream(stream, msg, chatConfig, {
    extractDelta(chunk: ChatCompletionChunk) {
      return chunk.choices?.[0]?.delta?.content ?? undefined;
    },
    extractToolCalls(chunk: ChatCompletionChunk) {
      return chunk.choices?.[0]?.delta?.tool_calls || [];
    },
    async finalize(fullText, helpers, toolCalls) {
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
        finalOutput = typeof message?.content === "string" ? message.content : "";
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
              message: {
                role: "assistant",
                content: fullText,
                tool_calls: toolCalls.length
                  ? (toolCalls as unknown as OpenAI.ChatCompletionMessageToolCall[])
                  : undefined,
              } as OpenAI.ChatCompletionAssistantMessageParam,
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
