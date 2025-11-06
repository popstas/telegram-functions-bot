/* eslint-disable @typescript-eslint/no-explicit-any */
import { jest, describe, it, expect, beforeEach, beforeAll } from "@jest/globals";
import type { Message } from "telegraf/types";
import type { ConfigChatType, GptContextType, ToolResponse } from "../../src/types.ts";

const mockExecuteTools = jest.fn();
const mockAddToHistory = jest.fn();
const mockForgetHistory = jest.fn();
const mockSendTelegramMessage = jest.fn();
const mockSendTelegramDocument = jest.fn();
const mockUseBot = jest.fn(() => ({
  telegram: {
    sendMessage: jest.fn(),
    editMessageText: jest.fn(),
    deleteMessage: jest.fn(),
  },
}));
const mockUseApi = jest.fn();
const mockUseLangfuse = jest.fn();

jest.unstable_mockModule("../../src/helpers/gpt/tools.ts", () => ({
  executeTools: mockExecuteTools,
  resolveChatTools: jest.fn(),
  getToolsPrompts: jest.fn(),
  getToolsSystemMessages: jest.fn(),
}));

jest.unstable_mockModule("../../src/helpers/history.ts", () => ({
  addToHistory: mockAddToHistory,
  forgetHistory: mockForgetHistory,
}));

jest.unstable_mockModule("../../src/telegram/send.ts", () => ({
  sendTelegramMessage: mockSendTelegramMessage,
  sendTelegramDocument: mockSendTelegramDocument,
  getTelegramForwardedUser: jest.fn(),
}));

jest.unstable_mockModule("../../src/bot.ts", () => ({
  useBot: mockUseBot,
}));

jest.unstable_mockModule("../../src/helpers/useApi.ts", () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.unstable_mockModule("../../src/helpers/useLangfuse.ts", () => ({
  default: () => mockUseLangfuse(),
}));
let handleModelAnswer: typeof import("../../src/helpers/gpt/llm.ts").handleModelAnswer;
let processToolResults: typeof import("../../src/helpers/gpt/llm.ts").processToolResults;

beforeAll(async () => {
  const mod = await import("../../src/helpers/gpt/llm.ts");
  handleModelAnswer = mod.handleModelAnswer;
  processToolResults = mod.processToolResults;
});

beforeEach(() => {
  mockExecuteTools.mockReset();
  mockAddToHistory.mockReset();
  mockForgetHistory.mockReset();
  mockSendTelegramMessage.mockReset();
  mockSendTelegramDocument.mockReset();
  mockUseBot.mockReset();
  mockUseApi.mockReset();
  mockUseLangfuse.mockReset();
  mockUseLangfuse.mockReturnValue({ trace: null });
});

describe("handleModelAnswer", () => {
  const msg: Message.TextMessage = {
    chat: { id: 1, type: "private" },
    message_id: 1,
    text: "hi",
  } as Message.TextMessage;
  const chatConfig: ConfigChatType = {
    name: "chat",
    completionParams: {},
    chatParams: {},
    toolParams: {},
  } as ConfigChatType;
  let gptContext: GptContextType;

  beforeEach(() => {
    gptContext = {
      thread: { id: 1, messages: [], msgs: [], completionParams: {} },
      messages: [],
      systemMessage: "",
      chatTools: [],
      prompts: [],
      tools: [],
    } as GptContextType;
  });

  it("parses tool_call tags and executes tools", async () => {
    const json = JSON.stringify({
      id: "1",
      type: "function",
      function: { name: "tool", arguments: "{}" },
    });
    const res = {
      choices: [{ message: { content: `<tool_call>${json}</tool_call>` } }],
    } as any;
    mockExecuteTools.mockResolvedValue(undefined);
    await handleModelAnswer({
      msg,
      res,
      chatConfig,
      expressRes: undefined,
      gptContext,
    });
    expect(mockExecuteTools).toHaveBeenCalledWith(
      [JSON.parse(json)],
      gptContext.chatTools,
      chatConfig,
      msg,
      undefined,
      undefined,
    );
    expect(mockAddToHistory).toHaveBeenCalled();
  });

  it("retries after cancelled tool call and keeps history valid", async () => {
    const res = {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "1",
                type: "function",
                function: { name: "tool", arguments: "{}" },
              },
            ],
          },
        },
      ],
    } as any;

    const cancellation = [] as unknown as ToolResponse[] & {
      cancelled: boolean;
      cancelMessages: string[];
    };
    cancellation.cancelled = true;
    cancellation.cancelMessages = ['{"name":"tool","arguments":"{}"}'];
    mockExecuteTools.mockResolvedValueOnce(cancellation);

    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: "done" } }],
    });
    mockUseApi.mockReturnValue({
      chat: { completions: { create: mockCreate } },
    });

    const result = await handleModelAnswer({
      msg,
      res,
      chatConfig,
      expressRes: undefined,
      gptContext,
    });

    expect(result.content).toBe("done");
    expect(mockExecuteTools).toHaveBeenCalledTimes(1);
    expect(mockUseApi).toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0] as any;
    expect(callArgs.messages[1]).toEqual(
      expect.objectContaining({ role: "assistant", content: "" }),
    );
    expect(callArgs.messages[2]).toEqual(
      expect.objectContaining({
        role: "user",
        content: 'tool call cancelled: {"name":"tool","arguments":"{}"}',
      }),
    );
    expect(
      gptContext.thread.messages.some((m) => (m as { tool_calls?: unknown[] }).tool_calls?.length),
    ).toBe(false);
  });
});

describe("processToolResults", () => {
  const msg: Message.TextMessage = {
    chat: { id: 1, type: "private" },
    message_id: 1,
    text: "hi",
  } as Message.TextMessage;
  const chatConfig: ConfigChatType = {
    name: "chat",
    completionParams: {},
    chatParams: {},
    toolParams: {},
  } as ConfigChatType;
  const baseContext: GptContextType = {
    thread: { id: 1, messages: [], msgs: [], completionParams: {} },
    messages: [],
    systemMessage: "",
    chatTools: [],
    prompts: [],
    tools: [],
  } as GptContextType;

  it("handles forget tool and clears history", async () => {
    const tool_res: ToolResponse[] = [{ content: "done" }];
    const messageAgent = {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "1",
          type: "function",
          function: { name: "forget", arguments: '{"message":"bye"}' },
        },
      ],
    } as any;
    const res = await processToolResults({
      tool_res,
      messageAgent,
      chatConfig,
      msg,
      expressRes: undefined,
      gptContext: { ...baseContext },
      level: 1,
    });
    expect(res.content).toBe("bye");
    expect(mockForgetHistory).toHaveBeenCalledWith(1);
  });

  it("sends file when resource returned", async () => {
    const resContent = JSON.stringify({
      content: [
        { type: "text", text: "file ready" },
        {
          type: "resource",
          resource: { uri: "file:///tmp/test.txt", name: "test.txt" },
        },
      ],
    });
    const tool_res: ToolResponse[] = [{ content: resContent }];
    const messageAgent = {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "1",
          type: "function",
          function: { name: "foo", arguments: "{}" },
        },
      ],
    } as any;
    await processToolResults({
      tool_res,
      messageAgent,
      chatConfig,
      msg,
      expressRes: undefined,
      gptContext: { ...baseContext },
      level: 1,
    });
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      1,
      "file ready",
      { deleteAfter: undefined },
      undefined,
      chatConfig,
    );
    expect(mockSendTelegramDocument).toHaveBeenCalledWith(
      1,
      "/tmp/test.txt",
      "test.txt",
      undefined,
      chatConfig,
    );
  });

  it("sends file when resource with blob is returned", async () => {
    const fileData = Buffer.from("hello").toString("base64");
    const resContent = JSON.stringify({
      content: [
        { type: "text", text: "blob ready" },
        {
          type: "resource",
          resource: {
            blob: fileData,
            name: "test.txt",
            mimeType: "text/plain",
          },
        },
      ],
    });
    const tool_res: ToolResponse[] = [{ content: resContent }];
    const messageAgent = {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "1",
          type: "function",
          function: { name: "foo", arguments: "{}" },
        },
      ],
    } as any;
    await processToolResults({
      tool_res,
      messageAgent,
      chatConfig,
      msg,
      expressRes: undefined,
      gptContext: { ...baseContext },
      level: 1,
    });
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      1,
      "blob ready",
      { deleteAfter: undefined },
      undefined,
      chatConfig,
    );
    expect(mockSendTelegramDocument).toHaveBeenCalledWith(
      1,
      Buffer.from(fileData, "base64"),
      "test.txt",
      "text/plain",
      chatConfig,
    );
  });
});
