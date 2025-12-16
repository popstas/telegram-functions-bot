import { jest, describe, it, expect, beforeEach, beforeAll } from "@jest/globals";
import type { Message } from "telegraf/types";
import type { ConfigChatType, ThreadStateType } from "../../src/types.ts";
import OpenAI from "openai";
import type { ChatCompletionStream } from "openai/lib/ChatCompletionStream.js";
import type { ChatCompletionChunk } from "openai/resources/chat/completions/completions";

const mockUseApi = jest.fn();
const mockUseLangfuse = jest.fn();
const mockObserveOpenAI = jest.fn();
const mockAddToHistory = jest.fn();
const mockForgetHistory = jest.fn();
const mockUseThreads = jest.fn(() => ({}) as Record<number, ThreadStateType>);
const mockResolveChatTools = jest.fn();
const mockGetToolsPrompts = jest.fn();
const mockGetSystemMessage = jest.fn();
const mockBuildMessages = jest.fn();
const mockReplaceUrl = jest.fn((s: string) => Promise.resolve(s));
const mockReplaceTool = jest.fn((s: string) => Promise.resolve(s));
const mockExecuteTools = jest.fn();
const mockGetToolsSystemMessages = jest.fn();
const mockSendTelegramMessage = jest.fn();
const mockSendTelegramDocument = jest.fn();
const mockGetFullName = jest.fn();
const mockIsAdminUser = jest.fn();
const mockForward = jest.fn();
const mockUseConfig = jest.fn();
const mockUseBot = jest.fn(() => ({
  telegram: {
    sendMessage: jest.fn(),
    editMessageText: jest.fn(),
    deleteMessage: jest.fn(),
  },
}));

jest.unstable_mockModule("../../src/helpers/useApi.ts", () => ({
  useApi: mockUseApi,
}));

jest.unstable_mockModule("../../src/helpers/useLangfuse.ts", () => ({
  default: mockUseLangfuse,
}));

jest.unstable_mockModule("langfuse", () => ({
  observeOpenAI: mockObserveOpenAI,
}));

jest.unstable_mockModule("../../src/bot.ts", () => ({
  useBot: mockUseBot,
}));

jest.unstable_mockModule("../../src/helpers/history.ts", () => ({
  addToHistory: mockAddToHistory,
  forgetHistory: mockForgetHistory,
}));

jest.unstable_mockModule("../../src/threads.ts", () => ({
  useThreads: mockUseThreads,
}));

jest.unstable_mockModule("../../src/helpers/gpt/tools.ts", () => ({
  executeTools: mockExecuteTools,
  resolveChatTools: mockResolveChatTools,
  getToolsPrompts: mockGetToolsPrompts,
  getToolsSystemMessages: mockGetToolsSystemMessages,
}));

jest.unstable_mockModule("../../src/helpers/gpt/messages.ts", () => ({
  getSystemMessage: mockGetSystemMessage,
  buildMessages: mockBuildMessages,
}));

jest.unstable_mockModule("../../src/helpers/placeholders.ts", () => ({
  replaceUrlPlaceholders: mockReplaceUrl,
  replaceToolPlaceholders: mockReplaceTool,
  replaceVarsPlaceholders: (s: string) => s,
}));

jest.unstable_mockModule("../../src/config.ts", () => ({
  useConfig: () => mockUseConfig(),
}));

jest.unstable_mockModule("../../src/telegram/send.ts", () => ({
  getTelegramForwardedUser: mockForward,
  sendTelegramMessage: mockSendTelegramMessage,
  sendTelegramDocument: mockSendTelegramDocument,
  getFullName: mockGetFullName,
  isAdminUser: mockIsAdminUser,
}));

let llm: typeof import("../../src/helpers/gpt/llm.ts");
let requestGptAnswer: typeof import("../../src/helpers/gpt/llm.ts").requestGptAnswer;
let threads: Record<number, ThreadStateType>;

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

beforeAll(async () => {
  llm = await import("../../src/helpers/gpt/llm.ts");
  requestGptAnswer = llm.requestGptAnswer;
});

beforeEach(() => {
  mockUseApi.mockReset();
  mockUseLangfuse.mockReset();
  mockObserveOpenAI.mockReset();
  mockUseBot.mockReset();
  mockUseThreads.mockReset();
  mockResolveChatTools.mockReset();
  mockGetToolsPrompts.mockReset();
  mockGetSystemMessage.mockReset();
  mockBuildMessages.mockReset();
  mockReplaceUrl.mockReset();
  mockReplaceTool.mockReset();
  mockExecuteTools.mockReset();
  mockGetToolsSystemMessages.mockReset();
  mockSendTelegramMessage.mockReset();
  mockSendTelegramDocument.mockReset();
  mockGetFullName.mockReset();
  mockIsAdminUser.mockReset();
  mockForward.mockReset();
  mockUseConfig.mockReset();
  threads = {} as Record<number, ThreadStateType>;
  mockUseThreads.mockReturnValue(threads);
  mockUseLangfuse.mockReturnValue({ trace: undefined });
  const api = {
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({ choices: [{ message: { content: "a" } }] }),
      },
    },
  };
  const apiObserved = {
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({ choices: [{ message: { content: "b" } }] }),
      },
    },
  };
  mockUseApi.mockReturnValue(api);
  mockObserveOpenAI.mockReturnValue(apiObserved);
  mockResolveChatTools.mockResolvedValue([]);
  mockGetToolsPrompts.mockResolvedValue([]);
  mockGetSystemMessage.mockResolvedValue("sys {date}");
  mockBuildMessages.mockResolvedValue([]);
  mockForward.mockReturnValue("Bob");
  mockUseConfig.mockReturnValue({ auth: {}, chats: [], local_models: [] });
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
    expect(calledParams.input).toEqual([{ role: "user", content: "hi", type: "message" }]);
    expect(calledParams.instructions).toBe("user name: Stanislav");
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

  it("passes responses params to responses api", async () => {
    mockUseLangfuse.mockReturnValue({ trace: undefined });
    const api = {
      responses: {
        create: jest.fn().mockResolvedValue({ output_text: "r" }),
      },
    };
    mockUseApi.mockReturnValue(api);
    const params = {
      messages: [{ role: "user", content: "hi" }],
      model: "m",
    } as OpenAI.ChatCompletionCreateParams;
    await llm.llmCall({
      apiParams: params,
      msg: { ...baseMsg },
      chatConfig: {
        ...chatConfig,
        local_model: undefined,
        responsesParams: {
          reasoning: { effort: "minimal" },
          text: { verbosity: "low" },
        },
        chatParams: { useResponsesApi: true, streaming: false },
      },
    });
    const calledParams = (api.responses.create as jest.Mock).mock.calls[0][0];
    expect(calledParams.reasoning).toEqual({ effort: "minimal" });
    expect(calledParams.text).toEqual({ verbosity: "low" });
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
    expect(calledParams.instructions).toBeUndefined();
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
        for (const e of events) yield e as unknown as OpenAI.Responses.ResponseStreamEvent;
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

  it("skips telegram streaming for responses api when responseButtons enabled", async () => {
    const events = [
      {
        type: "response.created",
        sequence_number: 0,
        response: { output: [], output_text: "" },
      },
      {
        type: "response.output_text.delta",
        sequence_number: 1,
        delta: '{"message":"hi"}',
        output_index: 0,
        item_id: "1",
      },
      {
        type: "response.completed",
        sequence_number: 2,
        response: { output_text: '{"message":"hi"}', output: [] },
      },
    ];
    const stream = {
      async *[Symbol.asyncIterator]() {
        for (const e of events) yield e as unknown as OpenAI.Responses.ResponseStreamEvent;
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
    await llm.llmCall({
      apiParams: params,
      msg: { ...baseMsg },
      chatConfig: {
        ...chatConfig,
        local_model: undefined,
        chatParams: {
          useResponsesApi: true,
          streaming: true,
          responseButtons: true,
        },
      },
    });
    expect(api.responses.stream).toHaveBeenCalled();
    expect(mockUseBot).not.toHaveBeenCalled();
  });

  it("uses completions streaming when enabled", async () => {
    const events = [{ choices: [{ delta: { content: "r" } }] } as ChatCompletionChunk];
    const stream = {
      async *[Symbol.asyncIterator]() {
        for (const e of events) yield e as ChatCompletionChunk;
      },
      finalChatCompletion: jest.fn().mockResolvedValue({
        choices: [{ message: { content: "r" } }],
      }),
      controller: { signal: undefined },
      on: jest.fn(),
    } as unknown as ChatCompletionStream;
    const api = {
      chat: {
        completions: {
          stream: jest.fn().mockReturnValue(stream),
          create: jest.fn(),
        },
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
        chatParams: { streaming: true },
      },
    });
    expect(api.chat.completions.stream).toHaveBeenCalled();
    expect(result.res.choices[0].message.content).toBe("r");
  });

  it("skips telegram streaming for completions when responseButtons enabled", async () => {
    const events = [
      {
        choices: [{ delta: { content: '{"message":"hi"}' } }],
      } as ChatCompletionChunk,
    ];
    const stream = {
      async *[Symbol.asyncIterator]() {
        for (const e of events) yield e as ChatCompletionChunk;
      },
      finalContent: jest.fn().mockResolvedValue('{"message":"hi"}'),
      controller: { signal: undefined },
      on: jest.fn(),
    } as unknown as ChatCompletionStream;
    const api = {
      chat: {
        completions: {
          stream: jest.fn().mockReturnValue(stream),
          create: jest.fn(),
        },
      },
    };
    mockUseApi.mockReturnValue(api);
    const params = {
      messages: [{ role: "user", content: "hi" }],
      model: "m",
    } as OpenAI.ChatCompletionCreateParams;
    await llm.llmCall({
      apiParams: params,
      msg: { ...baseMsg },
      chatConfig: {
        ...chatConfig,
        local_model: undefined,
        chatParams: { streaming: true, responseButtons: true },
      },
    });
    expect(api.chat.completions.stream).toHaveBeenCalled();
    expect(mockUseBot).not.toHaveBeenCalled();
  });

  it("falls back when finalChatCompletion missing", async () => {
    const events = [
      {
        choices: [{ delta: { content: "hello" }, finish_reason: "stop" }],
      } as ChatCompletionChunk,
    ];
    const stream = {
      async *[Symbol.asyncIterator]() {
        for (const e of events) yield e as ChatCompletionChunk;
      },
      on: jest.fn(),
      controller: { signal: undefined },
    } as unknown as ChatCompletionStream;
    const api = {
      chat: {
        completions: {
          stream: jest.fn().mockReturnValue(stream),
          create: jest.fn(),
        },
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
        chatParams: { streaming: true },
      },
    });
    expect(api.chat.completions.stream).toHaveBeenCalled();
    expect(result.res.choices[0].message.content).toBe("hello");
  });
});

describe("parseResponseButtonsAndTelemetry", () => {
  it("parses buttons from response format json", async () => {
    const result = await llm.parseResponseButtonsAndTelemetry({
      answer: JSON.stringify({ message: "Final", buttons: [{ name: "Do", prompt: "action" }] }),
      chatConfig: { ...chatConfig, chatParams: { responseButtons: true } },
      gptContext: {
        thread: { messages: [], completionParams: {}, id: 1 },
      } as unknown as llm.GptContextType,
      msg: baseMsg,
    });

    expect(result.buttons).toEqual([{ name: "Do", prompt: "action" }]);
    expect(result.content).toBe("Final");
  });
});

describe("generateButtonsFromAgent", () => {
  it("calls buttons agent and returns buttons", async () => {
    const buttonsAgent: ConfigChatType = {
      name: "Buttons",
      agent_name: "buttons",
      systemMessage: "Create buttons",
      completionParams: { model: "gpt-5-nano" },
      chatParams: {},
      toolParams: {},
      response_format: { type: "json_schema" },
    } as ConfigChatType;
    mockUseConfig.mockReturnValue({ auth: {}, chats: [buttonsAgent], local_models: [] });
    const createMock = jest.fn().mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify({ buttons: [{ name: "Do", prompt: "action" }] }) } },
      ],
    });
    mockUseApi.mockReturnValue({
      chat: {
        completions: {
          create: createMock,
          stream: jest.fn(),
        },
      },
    });

    const result = await llm.generateButtonsFromAgent("Final answer", baseMsg);

    expect(createMock).toHaveBeenCalled();
    expect(result).toEqual([{ name: "Do", prompt: "action" }]);
  });
});

describe("requestGptAnswer", () => {
  beforeEach(() => {
    mockResolveChatTools.mockResolvedValue([]);
    mockGetToolsPrompts.mockResolvedValue([]);
    mockGetSystemMessage.mockResolvedValue("sys {date}");
    mockBuildMessages.mockResolvedValue([]);
    mockForward.mockReturnValue("Bob");
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

  it("passes image_generation tool to API", async () => {
    const api = {
      responses: {
        create: jest.fn().mockResolvedValue({ output_text: "r" }),
      },
    };
    mockUseApi.mockReturnValue(api);
    const msg: Message.TextMessage = { ...baseMsg };
    await requestGptAnswer(msg, {
      ...chatConfig,
      tools: ["image_generation"],
      local_model: undefined,
      chatParams: { useResponsesApi: true, streaming: false },
    });
    const calledParams = (api.responses.create as jest.Mock).mock.calls[0][0];
    expect(calledParams.tools).toEqual([{ type: "image_generation" }]);
  });

  it("uses response_format from chat config", async () => {
    const api = {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({ choices: [{ message: { content: "a" } }] }),
        },
      },
    };
    mockUseApi.mockReturnValue(api);
    const msg: Message.TextMessage = { ...baseMsg };
    await requestGptAnswer(msg, {
      ...chatConfig,
      response_format: { type: "json_object" },
    });
    const calledParams = (api.chat.completions.create as jest.Mock).mock.calls[0][0];
    expect(calledParams.response_format).toEqual({ type: "json_object" });
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
    const sent = (await import("../../src/telegram/send.ts")).sendTelegramMessage as jest.Mock;
    const message = sent.mock.calls.pop()?.[1];
    expect(message).toContain("Web search:");
    expect(message).toContain("[T](https://u) (opened)");
  });

  it("sends generated image", async () => {
    const api = {
      responses: {
        create: jest.fn().mockResolvedValue({
          output_text: "img",
          output: [
            {
              id: "ig_1",
              type: "image_generation_call",
              status: "completed",
              result: Buffer.from("hello").toString("base64"),
            },
          ],
        }),
      },
    };
    mockUseApi.mockReturnValue(api);
    const msg: Message.TextMessage = { ...baseMsg };
    await requestGptAnswer(msg, {
      ...chatConfig,
      tools: ["image_generation"],
      local_model: undefined,
      chatParams: { useResponsesApi: true, streaming: false },
    });
    const sendDoc = (await import("../../src/telegram/send.ts")).sendTelegramDocument as jest.Mock;
    expect(sendDoc).toHaveBeenCalled();
  });
});
