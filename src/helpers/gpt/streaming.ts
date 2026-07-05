import OpenAI from "openai";
import { convertResponsesOutput } from "./responsesApi.ts";
import type { ConfigChatType } from "../../types.ts";
import { Message } from "grammy/types";
import { useBot } from "../../bot.ts";

let nextDraftId = 1;
export const __testStreaming = {
  reset() {
    nextDraftId = 1;
  },
};

export function createRichDraftFlusher(bot: ReturnType<typeof useBot>, msg: Message.TextMessage) {
  const draftId = nextDraftId++;
  const messageThreadId = (msg as { message_thread_id?: number }).message_thread_id;
  const threadOpts =
    messageThreadId !== undefined ? { message_thread_id: messageThreadId } : undefined;
  let fullText = "";
  let flushTimeout: NodeJS.Timeout | undefined;
  let processing = true;
  // Whether a rich draft was actually sent. Without this, finish() would send a
  // clear-draft even when the stream ended before the first 2s flush (short
  // answers, tool-call-only rounds), which briefly shows an empty draft bubble.
  let painted = false;
  // In-flight flush guard: finish() must await it so a late flush can't repaint
  // the draft after the clear below (same invariant as the old draft flusher).
  let activeFlush: Promise<void> | undefined;

  async function flush() {
    try {
      // 429s are retried by the auto-retry transformer installed in useBot().
      await bot.api.sendRichMessageDraft(msg.chat.id, draftId, { markdown: fullText }, threadOpts);
      painted = true;
    } catch (err) {
      console.warn("sendRichMessageDraft failed", err);
    }
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
    if (activeFlush) await activeFlush;
    if (painted) {
      try {
        // Clear the ephemeral draft (empty text allowed since Bot API 10.1); the
        // persisted answer is sent by the normal rich send path. Smoke item 5
        // verifies an empty plain draft clears a rich draft.
        await bot.api.sendMessageDraft(msg.chat.id, draftId, "", threadOpts);
      } catch (err) {
        console.warn("sendMessageDraft clear failed", err);
      }
    }
    return { fullText } as const;
  }

  return { add, finish } as const;
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
      toolCalls: {
        index: number;
        id?: string;
        function: { arguments: string; name?: string };
        type?: string;
      }[],
    ): Promise<R>;
  },
): Promise<R> {
  const bot = useBot(chatConfig?.bot_token);
  const flusher = createRichDraftFlusher(bot, msg);
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

  const { fullText } = await flusher.finish();

  return await callbacks.finalize(fullText, Object.values(finalToolCalls));
}

export async function handleResponseStream(
  stream: AsyncIterable<OpenAI.Responses.ResponseStreamEvent>,
  msg: Message.TextMessage,
  chatConfig?: ConfigChatType,
): Promise<{
  res: OpenAI.ChatCompletion;
  webSearchDetails?: string;
  images?: { id?: string; result: string }[];
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
    return await convertResponsesOutput(completed);
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
    async finalize(_fullText, toolCalls) {
      if (!completed) {
        throw new Error("No response.completed event received");
      }
      const result = await convertResponsesOutput(completed);
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
    return { res };
  }

  return handleStream(stream, msg, chatConfig, {
    extractDelta(chunk: ChatCompletionChunk) {
      return chunk.choices?.[0]?.delta?.content ?? undefined;
    },
    extractToolCalls(chunk: ChatCompletionChunk) {
      return chunk.choices?.[0]?.delta?.tool_calls || [];
    },
    async finalize(fullText, toolCalls) {
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
                tool_calls: toolCalls.length
                  ? (toolCalls as unknown as OpenAI.ChatCompletionMessageToolCall[])
                  : undefined,
              } as OpenAI.ChatCompletionAssistantMessageParam,
            } as OpenAI.ChatCompletion.Choice,
          ],
        } as OpenAI.ChatCompletion;
      }

      return { res };
    },
  });
}
