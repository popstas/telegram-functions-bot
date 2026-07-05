import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import type { ChatCompletionChunk } from "openai/resources/chat/completions/completions";
import type { ChatCompletionStream } from "openai/lib/ChatCompletionStream.js";
import type { Message } from "grammy/types";
import type { ConfigChatType } from "../../src/types.ts";

const sendRichMessageDraft = jest.fn(async () => true);
const sendMessageDraft = jest.fn(async () => true);
const fakeBot = { api: { sendRichMessageDraft, sendMessageDraft } } as never;

jest.unstable_mockModule("../../src/bot.ts", () => ({
  useBot: jest.fn(() => fakeBot),
  botReady: jest.fn(async () => {}),
  getBots: jest.fn(() => ({})),
  setRunnerHandle: jest.fn(),
  getRunnerHandles: jest.fn(() => ({})),
}));

const { createRichDraftFlusher, handleStream, handleCompletionStream, __testStreaming } =
  await import("../../src/helpers/gpt/streaming.ts");

const msg = { chat: { id: 5 }, message_id: 1 } as Message.TextMessage;

describe("createRichDraftFlusher", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    sendRichMessageDraft.mockClear();
    sendMessageDraft.mockClear();
    __testStreaming.reset();
  });
  afterEach(() => jest.useRealTimers());

  it("flushes accumulated markdown as one rich draft per 2s tick", async () => {
    const f = createRichDraftFlusher(fakeBot, msg);
    f.add("Hello ");
    f.add("**world**");
    await jest.advanceTimersByTimeAsync(2000);
    expect(sendRichMessageDraft).toHaveBeenCalledTimes(1);
    expect(sendRichMessageDraft).toHaveBeenCalledWith(
      5,
      1,
      { markdown: "Hello **world**" },
      undefined,
    );
  });

  it("reuses the same draft_id across flushes and increments per flusher", async () => {
    const f1 = createRichDraftFlusher(fakeBot, msg);
    f1.add("a");
    await jest.advanceTimersByTimeAsync(2000);
    f1.add("b");
    await jest.advanceTimersByTimeAsync(2000);
    expect(sendRichMessageDraft.mock.calls.map((c) => c[1])).toEqual([1, 1]);
    // Stop f1's recurring flush before starting f2 (real usage never overlaps two
    // flushers for the same message); otherwise f1's still-scheduled next tick and
    // f2's first tick land on the same fake-timer instant and race in call order.
    await f1.finish();
    const f2 = createRichDraftFlusher(fakeBot, msg);
    f2.add("c");
    await jest.advanceTimersByTimeAsync(2000);
    expect(sendRichMessageDraft.mock.calls[2][1]).toBe(2);
  });

  it("passes message_thread_id when present", async () => {
    const threadMsg = { chat: { id: 5 }, message_thread_id: 77 } as never;
    const f = createRichDraftFlusher(fakeBot, threadMsg);
    f.add("x");
    await jest.advanceTimersByTimeAsync(2000);
    expect(sendRichMessageDraft).toHaveBeenCalledWith(
      5,
      1,
      { markdown: "x" },
      { message_thread_id: 77 },
    );
  });

  it("finish() awaits in-flight flush, then clears via empty plain draft", async () => {
    let release!: () => void;
    sendRichMessageDraft.mockImplementationOnce(
      () => new Promise<true>((r) => (release = () => r(true))),
    );
    const f = createRichDraftFlusher(fakeBot, msg);
    f.add("slow");
    await jest.advanceTimersByTimeAsync(2000); // flush now in flight
    const finishP = f.finish();
    let finished = false;
    void finishP.then(() => (finished = true));
    await Promise.resolve();
    expect(finished).toBe(false); // blocked on in-flight flush
    release();
    const { fullText } = await finishP;
    expect(fullText).toBe("slow");
    expect(sendMessageDraft).toHaveBeenCalledWith(5, 1, "", undefined);
  });

  it("swallows draft errors and keeps streaming", async () => {
    sendRichMessageDraft.mockRejectedValueOnce(new Error("boom"));
    const f = createRichDraftFlusher(fakeBot, msg);
    f.add("x");
    await jest.advanceTimersByTimeAsync(2000);
    f.add("y");
    await jest.advanceTimersByTimeAsync(2000);
    expect(sendRichMessageDraft).toHaveBeenCalledTimes(2);
    await f.finish();
  });
});

describe("handleStream", () => {
  beforeEach(() => __testStreaming.reset());

  it("accumulates deltas + tool calls and passes them to finalize", async () => {
    async function* stream() {
      yield { d: "Hel", tc: [{ index: 0, id: "t1", function: { name: "fn", arguments: '{"a"' } }] };
      yield { d: "lo", tc: [{ index: 0, function: { arguments: ":1}" } }] };
    }
    const result = await handleStream(stream(), msg, undefined, {
      extractDelta: (c: { d?: string }) => c.d,
      extractToolCalls: (c: { tc?: never[] }) => c.tc,
      finalize: async (fullText, toolCalls) => ({ fullText, toolCalls }),
    });
    expect(result.fullText).toBe("Hello");
    expect(result.toolCalls).toEqual([
      { index: 0, id: "t1", type: undefined, function: { name: "fn", arguments: '{"a":1}' } },
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

describe("handleCompletionStream", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    sendRichMessageDraft.mockClear();
    sendMessageDraft.mockClear();
    __testStreaming.reset();
  });
  afterEach(() => jest.useRealTimers());

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

    const msgLocal: Message.TextMessage = {
      chat: { id: 1, type: "private" },
      message_id: 1,
      text: "hi",
    } as Message.TextMessage;
    const resultPromise = handleCompletionStream(stream, msgLocal);
    await jest.runAllTimersAsync();
    const { res } = await resultPromise;
    expect(res.choices[0].message.tool_calls).toEqual([
      {
        index: 0,
        id: "c1",
        type: "function",
        function: { name: "foo", arguments: '{"bar":1}' },
      },
    ]);
  });

  it("accumulates text deltas into the final content", async () => {
    const msgLocal = {
      chat: { id: 4, type: "private" },
      message_id: 1,
      text: "hi",
    } as unknown as Message.TextMessage;
    const chatConfig = {
      chatParams: { streaming: true },
    } as unknown as ConfigChatType;
    const resultPromise = handleCompletionStream(textStream(["Hi"]), msgLocal, chatConfig);
    await jest.runAllTimersAsync();
    const { res } = await resultPromise;
    expect(res.choices[0].message.content).toBe("Hi");
  });

  it("responseButtons: skips streaming drafts and returns the aggregated result", async () => {
    const msgLocal = {
      chat: { id: 9, type: "private" },
      message_id: 1,
      text: "hi",
    } as unknown as Message.TextMessage;
    const chatConfig = {
      chatParams: { responseButtons: true },
    } as unknown as ConfigChatType;
    const { res } = await handleCompletionStream(
      textStream(["Hi", " there"]),
      msgLocal,
      chatConfig,
    );
    expect(res.choices[0].message.content).toBe("Hi there");
    expect(sendRichMessageDraft).not.toHaveBeenCalled();
    expect(sendMessageDraft).not.toHaveBeenCalled();
  });
});
