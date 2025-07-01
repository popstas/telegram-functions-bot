import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Message } from "telegraf/types";
import type { ConfigChatType, GptContextType } from "../../src/types";
import OpenAI from "openai";

const mockExecuteTools = jest.fn();
const mockAddToHistory = jest.fn();
const mockForgetHistory = jest.fn();
const mockSendTelegramMessage = jest.fn();
const mockBuildMessages = jest.fn();
const mockUseApi = jest.fn();
const mockUseLangfuse = jest.fn();
const mockObserveOpenAI = jest.fn();
const mockUseConfig = jest.fn();
const mockUseThreads = jest.fn();
const mockResolveChatTools = jest.fn();
const mockGetToolsPrompts = jest.fn();
const mockGetSystemMessage = jest.fn();
const mockReplaceUrl = jest.fn((s: string) => Promise.resolve(s));
const mockReplaceTool = jest.fn((s: string) => Promise.resolve(s));
const mockLog = jest.fn();

jest.unstable_mockModule("../../src/helpers/gpt/tools.ts", () => ({
  executeTools: (...args: unknown[]) => mockExecuteTools(...args),
  resolveChatTools: (...args: unknown[]) => mockResolveChatTools(...args),
  getToolsPrompts: (...args: unknown[]) => mockGetToolsPrompts(...args),
  getToolsSystemMessages: jest.fn(),
}));

jest.unstable_mockModule("../../src/helpers/history.ts", () => ({
  addToHistory: (...args: unknown[]) => mockAddToHistory(...args),
  forgetHistory: (...args: unknown[]) => mockForgetHistory(...args),
}));

jest.unstable_mockModule("../../src/telegram/send.ts", () => ({
  sendTelegramMessage: (...args: unknown[]) => mockSendTelegramMessage(...args),
  getTelegramForwardedUser: jest.fn(),
  getFullName: jest.fn(),
  isAdminUser: jest.fn(),
}));

jest.unstable_mockModule("../../src/helpers/gpt/messages.ts", () => ({
  buildMessages: (...args: unknown[]) => mockBuildMessages(...args),
  getSystemMessage: (...args: unknown[]) => mockGetSystemMessage(...args),
}));

jest.unstable_mockModule("../../src/helpers/placeholders.ts", () => ({
  replaceUrlPlaceholders: (...args: unknown[]) => mockReplaceUrl(...args),
  replaceToolPlaceholders: (...args: unknown[]) => mockReplaceTool(...args),
}));

jest.unstable_mockModule("../../src/helpers/useApi.ts", () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.unstable_mockModule("../../src/helpers/useLangfuse.ts", () => ({
  default: (...args: unknown[]) => mockUseLangfuse(...args),
}));

jest.unstable_mockModule("langfuse", () => ({
  observeOpenAI: (...args: unknown[]) => mockObserveOpenAI(...args),
}));

jest.unstable_mockModule("../../src/config.ts", () => ({
  useConfig: () => mockUseConfig(),
}));

jest.unstable_mockModule("../../src/threads.ts", () => ({
  useThreads: () => mockUseThreads(),
}));

jest.unstable_mockModule("../../src/helpers.ts", () => ({
  log: (...args: unknown[]) => mockLog(...args),
}));

let llm: typeof import("../../src/helpers/gpt/llm.ts");
let handleModelAnswer: typeof import("../../src/helpers/gpt/llm.ts").handleModelAnswer;
let processToolResults: typeof import("../../src/helpers/gpt/llm.ts").processToolResults;
let requestGptAnswer: typeof import("../../src/helpers/gpt/llm.ts").requestGptAnswer;

const baseMsg: Message.TextMessage = {
  chat: { id: 1, type: "private" },
  message_id: 1,
  text: "hi",
} as Message.TextMessage;

const chatConfig: ConfigChatType = {
  name: "chat",
  completionParams: {},
  chatParams: {},
  toolParams: {},
  local_model: "loc",
} as ConfigChatType;

const baseContext: GptContextType = {
  thread: { id: 1, messages: [], msgs: [], completionParams: {} },
  messages: [],
  systemMessage: "",
  chatTools: [],
  prompts: [],
  tools: [],
} as GptContextType;

let mockCreate: jest.Mock;

beforeEach(async () => {
  jest.resetModules();
  mockExecuteTools.mockReset();
  mockAddToHistory.mockReset();
  mockForgetHistory.mockReset();
  mockSendTelegramMessage.mockReset();
  mockBuildMessages.mockReset();
  mockUseApi.mockReset();
  mockUseLangfuse.mockReset();
  mockObserveOpenAI.mockReset();
  mockUseConfig.mockReset();
  mockUseThreads.mockReset();
  mockResolveChatTools.mockReset();
  mockGetToolsPrompts.mockReset();
  mockGetSystemMessage.mockReset();
  mockReplaceUrl.mockReset();
  mockReplaceTool.mockReset();
  mockLog.mockReset();

  mockUseThreads.mockReturnValue({});
  mockResolveChatTools.mockResolvedValue([]);
  mockGetToolsPrompts.mockResolvedValue([]);
  mockGetSystemMessage.mockResolvedValue("");
  mockBuildMessages.mockResolvedValue([]);
  mockUseLangfuse.mockReturnValue({ trace: undefined });
  mockObserveOpenAI.mockImplementation((api) => api);
  mockUseConfig.mockReturnValue({ local_models: [], chats: [], auth: {} });
  mockReplaceUrl.mockImplementation((s: string) => Promise.resolve(s));
  mockReplaceTool.mockImplementation((s: string) => Promise.resolve(s));

  mockCreate = jest.fn();
  mockUseApi.mockReturnValue({ chat: { completions: { create: mockCreate } } });

  llm = await import("../../src/helpers/gpt/llm.ts");
  handleModelAnswer = llm.handleModelAnswer;
  processToolResults = llm.processToolResults;
  requestGptAnswer = llm.requestGptAnswer;
});

describe("handleModelAnswer with tool result", () => {
  it("returns processed result when tools respond", async () => {
    const toolCall = {
      id: "1",
      type: "function",
      function: { name: "tool", arguments: "{}" },
    };
    const res: OpenAI.ChatCompletion = {
      choices: [{ message: { role: "assistant", tool_calls: [toolCall] } }],
    } as OpenAI.ChatCompletion;
    mockExecuteTools.mockResolvedValue([{ content: "ok" }]);
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "final" } }],
    });

    const result = await handleModelAnswer({
      msg: { ...baseMsg },
      res,
      chatConfig,
      expressRes: undefined,
      gptContext: { ...baseContext },
    });

    expect(result.content).toBe("final");
    expect(mockExecuteTools).toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalled();
  });
});

describe("processToolResults non forget", () => {
  it("calls llm and returns answer", async () => {
    const tool_res = [{ content: "done" }];
    const messageAgent: OpenAI.ChatCompletionMessage = {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "1",
          type: "function",
          function: { name: "tool", arguments: "{}" },
        },
      ],
    } as OpenAI.ChatCompletionMessage;
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "answer" } }],
    });

    const res = await processToolResults({
      tool_res,
      messageAgent,
      chatConfig,
      msg: { ...baseMsg },
      expressRes: undefined,
      noSendTelegram: false,
      gptContext: { ...baseContext },
      level: 1,
    });

    expect(res.content).toBe("answer");
    expect(mockSendTelegramMessage).toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalled();
  });
});

describe("runEvaluatorWorkflow via requestGptAnswer", () => {
  const evaluatorChat = {
    name: "url",
    agent_name: "url",
    id: 2,
    completionParams: { model: "loc" },
    systemMessage: "Check for URL in answer. 1 - no url, 5 - url present",
  } as ConfigChatType;

  it("improves answer when score low", async () => {
    mockUseConfig.mockReturnValue({
      local_models: [{ name: "loc", model: "loc" }],
      chats: [evaluatorChat],
      auth: {},
    });
    const responses = [
      { choices: [{ message: { content: "initial" } }] },
      {
        choices: [
          {
            message: {
              content: JSON.stringify({
                score: 2,
                justification: "bad",
                is_complete: false,
              }),
            },
          },
        ],
      },
      { choices: [{ message: { content: "fixed" } }] },
      {
        choices: [
          {
            message: {
              content: JSON.stringify({
                score: 5,
                justification: "good",
                is_complete: true,
              }),
            },
          },
        ],
      },
    ];
    mockCreate.mockImplementation(() => Promise.resolve(responses.shift()));

    const configWithEval = {
      ...chatConfig,
      evaluators: [{ agent_name: "url" }],
    } as ConfigChatType;
    const res = await requestGptAnswer({ ...baseMsg }, configWithEval);
    expect(res?.content).toBe("fixed");
    expect(mockCreate).toHaveBeenCalledTimes(4);
  });

  it("keeps answer when score high", async () => {
    mockUseConfig.mockReturnValue({
      local_models: [{ name: "loc", model: "loc" }],
      chats: [evaluatorChat],
      auth: {},
    });
    const responses = [
      { choices: [{ message: { content: "initial" } }] },
      {
        choices: [
          {
            message: {
              content: JSON.stringify({
                score: 5,
                justification: "good",
                is_complete: true,
              }),
            },
          },
        ],
      },
    ];
    mockCreate.mockImplementation(() => Promise.resolve(responses.shift()));

    const configWithEval = {
      ...chatConfig,
      evaluators: [{ agent_name: "url" }],
    } as ConfigChatType;
    const res = await requestGptAnswer({ ...baseMsg }, configWithEval);
    expect(res?.content).toBe("initial");
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});
