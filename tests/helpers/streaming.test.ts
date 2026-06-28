import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import type { ChatCompletionChunk } from "openai/resources/chat/completions/completions";
import type { ChatCompletionStream } from "openai/lib/ChatCompletionStream.js";
import type { Message } from "telegraf/types";
import type { ConfigChatType } from "../../src/types.ts";

const telegramMock = {
  sendMessage: jest.fn() as jest.Mock<(...args: unknown[]) => Promise<unknown>>,
  editMessageText: jest.fn() as jest.Mock<(...args: unknown[]) => Promise<unknown>>,
  deleteMessage: jest.fn() as jest.Mock<(...args: unknown[]) => Promise<unknown>>,
  callApi: jest.fn() as jest.Mock<(...args: unknown[]) => Promise<unknown>>,
};

jest.unstable_mockModule("../../src/bot.ts", () => ({
  useBot: () => ({ telegram: telegramMock }),
}));

let handleCompletionStream: typeof import("../../src/helpers/gpt/streaming.ts").handleCompletionStream;
let createDraftFlusher: typeof import("../../src/helpers/gpt/streaming.ts").createDraftFlusher;
let safeSendDraft: typeof import("../../src/helpers/gpt/streaming.ts").safeSendDraft;

beforeEach(async () => {
  jest.resetModules();
  telegramMock.sendMessage.mockReset().mockResolvedValue({ message_id: 1, chat: { id: 1 } });
  telegramMock.editMessageText.mockReset().mockResolvedValue(undefined);
  telegramMock.deleteMessage.mockReset().mockResolvedValue(undefined);
  telegramMock.callApi.mockReset().mockResolvedValue(undefined);
  ({ handleCompletionStream, createDraftFlusher, safeSendDraft } = await import(
    "../../src/helpers/gpt/streaming.ts"
  ));
});

describe("handleCompletionStream tool_calls", () => {
  it("aggregates tool call deltas", async () => {
    const events: ChatCompletionChunk[] = [
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "c1",
                  type: "function",
                  function: { name: "foo", arguments: "" },
                },
              ],
            },
          },
        ],
      } as ChatCompletionChunk,
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '{"bar"' } }],
            },
          },
        ],
      } as ChatCompletionChunk,
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: ":1}" } }],
            },
          },
        ],
      } as ChatCompletionChunk,
    ];

    const stream: ChatCompletionStream = {
      async *[Symbol.asyncIterator]() {
        for (const e of events) yield e;
      },
      on: jest.fn(),
      controller: { signal: undefined },
    } as unknown as ChatCompletionStream;

    const msg: Message.TextMessage = {
      chat: { id: 1, type: "private" },
      message_id: 1,
      text: "hi",
    } as Message.TextMessage;
    const { res } = await handleCompletionStream(stream, msg);
    expect(res.choices[0].message.tool_calls).toEqual([
      {
        index: 0,
        id: "c1",
        type: "function",
        function: { name: "foo", arguments: '{"bar":1}' },
      },
    ]);
  });
});

function textStream(deltas: string[]): ChatCompletionStream {
  return {
    async *[Symbol.asyncIterator]() {
      for (const d of deltas) {
        yield { choices: [{ index: 0, delta: { content: d } }] } as ChatCompletionChunk;
      }
    },
    on: jest.fn(),
    controller: { signal: undefined },
  } as unknown as ChatCompletionStream;
}

describe("createDraftFlusher", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("flushes accumulated text via sendMessageDraft with message_thread_id", async () => {
    const bot = { telegram: telegramMock } as never;
    const msg = {
      chat: { id: 42, type: "supergroup" },
      message_id: 5,
      message_thread_id: 99,
      text: "hi",
    } as unknown as Message.TextMessage;
    const flusher = createDraftFlusher(bot, msg);
    flusher.add("Hello");
    flusher.add(" world");
    await jest.advanceTimersByTimeAsync(2000);
    expect(telegramMock.callApi).toHaveBeenCalledWith("sendMessageDraft", {
      chat_id: 42,
      text: "Hello world",
      message_thread_id: 99,
    });
  });

  it("clears the draft on finish", async () => {
    const bot = { telegram: telegramMock } as never;
    const msg = {
      chat: { id: 7, type: "private" },
      message_id: 1,
      text: "hi",
    } as unknown as Message.TextMessage;
    const flusher = createDraftFlusher(bot, msg);
    flusher.add("partial");
    const { fullText } = await flusher.finish();
    expect(fullText).toBe("partial");
    expect(telegramMock.callApi).toHaveBeenLastCalledWith("sendMessageDraft", {
      chat_id: 7,
      text: "",
    });
  });

  it("finish waits for a 429-retrying in-flight flush before clearing the draft", async () => {
    const bot = { telegram: telegramMock } as never;
    const msg = {
      chat: { id: 8, type: "private" },
      message_id: 1,
      text: "hi",
    } as unknown as Message.TextMessage;
    // First draft send 429s (safeSendDraft sleeps and will retry the stale text),
    // then succeeds. The clear must come AFTER that retry, not race ahead of it.
    telegramMock.callApi
      .mockRejectedValueOnce({ response: { error_code: 429, parameters: { retry_after: 1 } } })
      .mockResolvedValue(undefined);
    const flusher = createDraftFlusher(bot, msg);
    flusher.add("stale");
    await jest.advanceTimersByTimeAsync(2000); // timeout fires; flush 429s, now sleeping
    const finishP = flusher.finish();
    await jest.advanceTimersByTimeAsync(1000); // release the retry delay
    await finishP;
    // Final call must be the empty clear, so no stale text is left in the draft.
    expect(telegramMock.callApi).toHaveBeenLastCalledWith("sendMessageDraft", {
      chat_id: 8,
      text: "",
    });
  });
});

describe("safeSendDraft", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("retries on 429 honoring retry_after", async () => {
    const bot = { telegram: telegramMock } as never;
    telegramMock.callApi
      .mockRejectedValueOnce({
        response: { error_code: 429, parameters: { retry_after: 1 } },
      })
      .mockResolvedValueOnce(undefined);
    const p = safeSendDraft(bot, 1, "text");
    await jest.advanceTimersByTimeAsync(1000);
    await p;
    expect(telegramMock.callApi).toHaveBeenCalledTimes(2);
  });

  it("swallows a non-429 error without throwing", async () => {
    const bot = { telegram: telegramMock } as never;
    telegramMock.callApi.mockRejectedValueOnce(new Error("backend lacks sendMessageDraft"));
    await expect(safeSendDraft(bot, 1, "text")).resolves.toBeUndefined();
    expect(telegramMock.callApi).toHaveBeenCalledTimes(1);
  });
});

describe("handleCompletionStream draft mode", () => {
  it("uses sendMessageDraft and never sends a preview message", async () => {
    const msg = {
      chat: { id: 3, type: "supergroup" },
      message_id: 1,
      message_thread_id: 12,
      text: "hi",
    } as unknown as Message.TextMessage;
    const chatConfig = {
      chatParams: { streaming: true, streamMode: "draft" },
    } as unknown as ConfigChatType;
    const { res } = await handleCompletionStream(textStream(["Hel", "lo"]), msg, chatConfig);
    expect(res.choices[0].message.content).toBe("Hello");
    // preview drafts go through callApi, not real sent/edited messages
    expect(telegramMock.sendMessage).not.toHaveBeenCalled();
    expect(telegramMock.callApi).toHaveBeenCalledWith("sendMessageDraft", {
      chat_id: 3,
      text: "",
      message_thread_id: 12,
    });
  });

  it("edit mode (default) does not call sendMessageDraft", async () => {
    const msg = {
      chat: { id: 4, type: "private" },
      message_id: 1,
      text: "hi",
    } as unknown as Message.TextMessage;
    const chatConfig = {
      chatParams: { streaming: true },
    } as unknown as ConfigChatType;
    const { res } = await handleCompletionStream(textStream(["Hi"]), msg, chatConfig);
    expect(res.choices[0].message.content).toBe("Hi");
    expect(telegramMock.callApi).not.toHaveBeenCalled();
  });
});
