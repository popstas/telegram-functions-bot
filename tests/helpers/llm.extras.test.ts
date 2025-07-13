import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Message } from "telegraf/types";
import type { ConfigChatType, ThreadStateType } from "../../src/types";
import OpenAI from "openai";

const mockUseApi = jest.fn();
const mockUseLangfuse = jest.fn();
const mockObserveOpenAI = jest.fn();
const mockAddToHistory = jest.fn();
const mockForgetHistory = jest.fn();

jest.unstable_mockModule("../../src/helpers/useApi.ts", () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.unstable_mockModule("../../src/helpers/useLangfuse.ts", () => ({
  default: (...args: unknown[]) => mockUseLangfuse(...args),
}));

jest.unstable_mockModule("langfuse", () => ({
  observeOpenAI: (...args: unknown[]) => mockObserveOpenAI(...args),
}));

jest.unstable_mockModule("../../src/helpers/history.ts", () => ({
  addToHistory: (...args: unknown[]) => mockAddToHistory(...args),
  forgetHistory: (...args: unknown[]) => mockForgetHistory(...args),
}));

let llm: typeof import("../../src/helpers/gpt/llm.ts");

const baseMsg: Message.TextMessage = {
  chat: { id: 1, type: "private", title: "chat" },
  message_id: 1,
  text: "hi",
  from: { username: "u" },
} as Message.TextMessage;

const chatConfig: ConfigChatType = {
  name: "chat",
  completionParams: {},
  chatParams: {},
  toolParams: {},
  local_model: "model",
} as ConfigChatType;

beforeEach(async () => {
  jest.resetModules();
  mockUseApi.mockReset();
  mockUseLangfuse.mockReset();
  mockObserveOpenAI.mockReset();
  mockUseLangfuse.mockReturnValue({ trace: undefined });
  const api = {
    chat: {
      completions: {
        create: jest
          .fn()
          .mockResolvedValue({ choices: [{ message: { content: "a" } }] }),
      },
    },
  };
  const apiObserved = {
    chat: {
      completions: {
        create: jest
          .fn()
          .mockResolvedValue({ choices: [{ message: { content: "b" } }] }),
      },
    },
  };
  mockUseApi.mockReturnValue(api);
  mockObserveOpenAI.mockReturnValue(apiObserved);
  llm = await import("../../src/helpers/gpt/llm.ts");
});

describe("llmCall", () => {
  it("calls API directly when no trace", async () => {
    mockUseLangfuse.mockReturnValue({ trace: undefined });
    const params = {
      messages: [],
      model: "m",
    } as OpenAI.ChatCompletionCreateParams;
    const result = await llm.llmCall({
      apiParams: params,
      msg: { ...baseMsg },
      chatConfig,
    });
    expect(mockUseApi).toHaveBeenCalledWith("model");
    expect(mockObserveOpenAI).not.toHaveBeenCalled();
    expect(result.res).toEqual({ choices: [{ message: { content: "a" } }] });
  });

  it("wraps api when trace exists", async () => {
    mockUseLangfuse.mockReturnValue({ trace: {} });
    const params = {
      messages: [],
      model: "m",
    } as OpenAI.ChatCompletionCreateParams;
    const result = await llm.llmCall({
      apiParams: params,
      msg: { ...baseMsg },
      chatConfig,
      generationName: "gen",
      localModel: "other",
    });
    expect(mockUseApi).toHaveBeenCalledWith("other");
    expect(mockObserveOpenAI).toHaveBeenCalled();
    expect(result.res).toEqual({ choices: [{ message: { content: "b" } }] });
  });

  it("uses responses api when enabled", async () => {
    mockUseLangfuse.mockReturnValue({ trace: undefined });
    const api = {
      responses: {
        create: jest.fn().mockResolvedValue({ output_text: "r" }),
      },
    };
    mockUseApi.mockReturnValue(api);
    const params = {
      messages: [{ role: "user", content: "hi", name: "Stanislav" }],
      model: "m",
      tools: [
        {
          type: "function",
          function: {
            name: "t",
            description: "d",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    } as OpenAI.ChatCompletionCreateParams;
    const result = await llm.llmCall({
      apiParams: params,
      msg: { ...baseMsg },
      chatConfig: {
        ...chatConfig,
        local_model: undefined,
        chatParams: { useResponsesApi: true, streaming: false },
      },
    });
    const calledParams = (api.responses.create as jest.Mock).mock.calls[0][0];
    expect(calledParams.input).toEqual([
      { role: "user", content: "hi", type: "message" },
    ]);
    expect(calledParams.tools).toEqual([
      {
        type: "function",
        name: "t",
        description: "d",
        parameters: { type: "object", properties: {} },
      },
    ]);
    expect(result.res.choices[0].message.content).toBe("r");
  });

  it("handles responses function_call", async () => {
    mockUseLangfuse.mockReturnValue({ trace: undefined });
    const api = {
      responses: {
        create: jest.fn().mockResolvedValue({
          output_text: "",
          output: [
            {
              type: "function_call",
              call_id: "call1",
              name: "t",
              arguments: "{}",
            },
          ],
        }),
      },
    };
    mockUseApi.mockReturnValue(api);
    const params = {
      messages: [{ role: "user", content: "hi", name: "Stanislav" }],
      model: "m",
      tools: [
        {
          type: "function",
          function: {
            name: "t",
            description: "d",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    } as OpenAI.ChatCompletionCreateParams;
    const result = await llm.llmCall({
      apiParams: params,
      msg: { ...baseMsg },
      chatConfig: {
        ...chatConfig,
        local_model: undefined,
        chatParams: { useResponsesApi: true, streaming: false },
      },
    });
    expect(result.res.choices[0].message.tool_calls).toEqual([
      {
        id: "call1",
        call_id: "call1",
        type: "function",
        function: { name: "t", arguments: "{}" },
      },
    ]);
  });

  it("converts tool messages for responses api", async () => {
    mockUseLangfuse.mockReturnValue({ trace: undefined });
    const api = {
      responses: {
        create: jest.fn().mockResolvedValue({ output_text: "r" }),
      },
    };
    mockUseApi.mockReturnValue(api);
    const params = {
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "x",
              type: "function",
              function: { name: "t", arguments: "{}" },
            },
          ],
        } as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam,
        { role: "tool", content: "res", tool_call_id: "x" },
      ],
      model: "m",
    } as OpenAI.ChatCompletionCreateParams;
    await llm.llmCall({
      apiParams: params,
      msg: { ...baseMsg },
      chatConfig: {
        ...chatConfig,
        local_model: undefined,
        chatParams: { useResponsesApi: true, streaming: false },
      },
    });
    const calledParams = (api.responses.create as jest.Mock).mock.calls[0][0];
    expect(calledParams.input).toEqual([
      {
        type: "function_call",
        name: "t",
        arguments: "{}",
        call_id: "x",
      },
      { type: "function_call_output", call_id: "x", output: "res" },
    ]);
  });

  it("uses responses streaming when enabled", async () => {
    mockUseLangfuse.mockReturnValue({ trace: undefined });
    const events = [
      {
        type: "response.created",
        sequence_number: 0,
        response: { output: [], output_text: "" },
      },
      {
        type: "response.completed",
        sequence_number: 1,
        response: { output_text: "r", output: [] },
      },
    ];
    const stream = {
      async *[Symbol.asyncIterator]() {
        for (const e of events)
          yield e as unknown as OpenAI.Responses.ResponseStreamEvent;
      },
      controller: { signal: undefined },
      on: jest.fn(),
    } as unknown as AsyncIterable<OpenAI.Responses.ResponseStreamEvent>;
    const api = {
      responses: {
        stream: jest.fn().mockReturnValue(stream),
        create: jest.fn(),
      },
    };
    mockUseApi.mockReturnValue(api);
    const params = {
      messages: [{ role: "user", content: "hi" }],
      model: "m",
    } as OpenAI.ChatCompletionCreateParams;
    const result = await llm.llmCall({
      apiParams: params,
      msg: { ...baseMsg },
      chatConfig: {
        ...chatConfig,
        local_model: undefined,
        chatParams: { useResponsesApi: true, streaming: true },
      },
    });
    expect(api.responses.stream).toHaveBeenCalled();
    expect(result.res.choices[0].message.content).toBe("r");
  });
});

describe("requestGptAnswer", () => {
  const threads: Record<number, ThreadStateType> = {};
  const mockUseThreads = jest.fn(() => threads);
  const mockResolveChatTools = jest.fn();
  const mockGetToolsPrompts = jest.fn();
  const mockGetSystemMessage = jest.fn();
  const mockBuildMessages = jest.fn();
  const mockReplaceUrl = jest.fn((s: string) => Promise.resolve(s));
  const mockReplaceTool = jest.fn((s: string) => Promise.resolve(s));
  const mockForward = jest.fn();

  jest.unstable_mockModule("../../src/threads.ts", () => ({
    useThreads: () => mockUseThreads(),
  }));
  jest.unstable_mockModule("../../src/helpers/gpt/tools.ts", () => ({
    executeTools: jest.fn(),
    resolveChatTools: (...args: unknown[]) => mockResolveChatTools(...args),
    getToolsPrompts: (...args: unknown[]) => mockGetToolsPrompts(...args),
    getToolsSystemMessages: jest.fn(),
  }));
  jest.unstable_mockModule("../../src/helpers/gpt/messages.ts", () => ({
    getSystemMessage: (...args: unknown[]) => mockGetSystemMessage(...args),
    buildMessages: (...args: unknown[]) => mockBuildMessages(...args),
  }));
  jest.unstable_mockModule("../../src/helpers/placeholders.ts", () => ({
    replaceUrlPlaceholders: (...args: unknown[]) => mockReplaceUrl(...args),
    replaceToolPlaceholders: (...args: unknown[]) => mockReplaceTool(...args),
  }));
  jest.unstable_mockModule("../../src/telegram/send.ts", () => ({
    getTelegramForwardedUser: (...args: unknown[]) => mockForward(...args),
    sendTelegramMessage: jest.fn(),
    sendTelegramDocument: jest.fn(),
    getFullName: jest.fn(),
    isAdminUser: jest.fn(),
  }));

  let requestGptAnswer: typeof llm.requestGptAnswer;

  beforeEach(async () => {
    jest.resetModules();
    mockUseLangfuse.mockReturnValue({ trace: undefined });
    mockUseThreads.mockClear();
    mockResolveChatTools.mockResolvedValue([]);
    mockGetToolsPrompts.mockResolvedValue([]);
    mockGetSystemMessage.mockResolvedValue("sys {date}");
    mockBuildMessages.mockResolvedValue([]);
    mockForward.mockReturnValue("Bob");
    const mod = await import("../../src/helpers/gpt/llm.ts");
    requestGptAnswer = mod.requestGptAnswer;
  });

  it("returns undefined when no text", async () => {
    const msg = {
      chat: { id: 1, type: "private" },
      message_id: 1,
    } as Message.TextMessage;
    const res = await requestGptAnswer(msg, chatConfig);
    expect(res).toBeUndefined();
  });

  it("adds forwarded name and creates thread", async () => {
    const msg: Message.TextMessage = { ...baseMsg };
    const res = await requestGptAnswer(msg, chatConfig);
    expect(mockForward).toHaveBeenCalledWith(msg, chatConfig);
    expect(msg.text).toBe("Переслано от: Bob\nhi");
    expect(threads[1]).toBeDefined();
    expect(res?.content).toBe("a");
  });

  it("passes web_search_preview tool to API", async () => {
    const api = {
      responses: {
        create: jest.fn().mockResolvedValue({ output_text: "r" }),
      },
    };
    mockUseApi.mockReturnValue(api);
    const msg: Message.TextMessage = { ...baseMsg };
    await requestGptAnswer(msg, {
      ...chatConfig,
      tools: ["web_search_preview"],
      local_model: undefined,
      chatParams: { useResponsesApi: true, streaming: false },
    });
    const calledParams = (api.responses.create as jest.Mock).mock.calls[0][0];
    expect(calledParams.tools).toEqual([{ type: "web_search_preview" }]);
  });

  it("sends web search details", async () => {
    const api = {
      responses: {
        create: jest.fn().mockResolvedValue({
          output_text: "a",
          output: [
            '{"type":"web_search_call","action":{"type":"search","query":"q"}}',
            '{"type":"web_search_call","action":{"type":"open_page","url":"https://u"}}',
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "a",
                  annotations: [
                    {
                      type: "url_citation",
                      title: "T",
                      url: "https://u",
                    },
                  ],
                },
              ],
            },
          ],
        }),
      },
    };
    mockUseApi.mockReturnValue(api);
    const msg: Message.TextMessage = { ...baseMsg };
    await requestGptAnswer(msg, {
      ...chatConfig,
      tools: ["web_search_preview"],
      local_model: undefined,
      chatParams: { useResponsesApi: true, streaming: false },
    });
    const sent = (await import("../../src/telegram/send.ts"))
      .sendTelegramMessage as jest.Mock;
    const message = sent.mock.calls.pop()?.[1];
    expect(message).toContain("Web search:");
    expect(message).toContain("[T](https://u) (opened)");
  });
});
