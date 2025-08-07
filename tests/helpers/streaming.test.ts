import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { ChatCompletionChunk } from "openai/resources/chat/completions/completions";
import type { ChatCompletionStream } from "openai/lib/ChatCompletionStream.js";
import type { Message } from "telegraf/types";

jest.unstable_mockModule("../../src/bot.ts", () => ({
  useBot: () => ({
    telegram: {
      sendMessage: jest.fn().mockResolvedValue({ message_id: 1, chat: { id: 1 } }),
      editMessageText: jest.fn(),
      deleteMessage: jest.fn(),
    },
  }),
}));

let handleCompletionStream: typeof import("../../src/helpers/gpt/streaming.ts").handleCompletionStream;

beforeEach(async () => {
  jest.resetModules();
  ({ handleCompletionStream } = await import("../../src/helpers/gpt/streaming.ts"));
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
