/* eslint-disable @typescript-eslint/no-explicit-any */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Message } from "telegraf/types";
import type {
  ConfigChatType,
  GptContextType,
  ToolResponse,
} from "../../src/types";

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

jest.unstable_mockModule("../../src/helpers/gpt/tools.ts", () => ({
  executeTools: (...args: unknown[]) => mockExecuteTools(...args),
  resolveChatTools: jest.fn(),
  getToolsPrompts: jest.fn(),
  getToolsSystemMessages: jest.fn(),
}));

jest.unstable_mockModule("../../src/helpers/history.ts", () => ({
  addToHistory: (...args: unknown[]) => mockAddToHistory(...args),
  forgetHistory: (...args: unknown[]) => mockForgetHistory(...args),
}));

jest.unstable_mockModule("../../src/telegram/send.ts", () => ({
  sendTelegramMessage: (...args: unknown[]) => mockSendTelegramMessage(...args),
  sendTelegramDocument: (...args: unknown[]) =>
    mockSendTelegramDocument(...args),
  getTelegramForwardedUser: jest.fn(),
}));

jest.unstable_mockModule("../../src/bot.ts", () => ({
  useBot: () => mockUseBot(),
}));

let handleModelAnswer: typeof import("../../src/helpers/gpt/llm.ts").handleModelAnswer;
let processToolResults: typeof import("../../src/helpers/gpt/llm.ts").processToolResults;

beforeEach(async () => {
  jest.resetModules();
  mockExecuteTools.mockReset();
  mockAddToHistory.mockReset();
  mockForgetHistory.mockReset();
  mockSendTelegramMessage.mockReset();
  mockSendTelegramDocument.mockReset();
  const mod = await import("../../src/helpers/gpt/llm.ts");
  handleModelAnswer = mod.handleModelAnswer;
  processToolResults = mod.processToolResults;
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
  const gptContext: GptContextType = {
    thread: { id: 1, messages: [], msgs: [], completionParams: {} },
    messages: [],
    systemMessage: "",
    chatTools: [],
    prompts: [],
    tools: [],
  } as GptContextType;

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
