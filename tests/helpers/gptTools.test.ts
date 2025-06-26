import { jest, describe, it, beforeEach, expect } from "@jest/globals";
import type { Message } from "telegraf/types";
import type {
  ConfigChatType,
  ChatToolType,
  ThreadStateType,
} from "../../src/types";
import type { ChatCompletionMessageToolCall } from "openai/resources/chat/completions";

// Mocks
const mockUseTools = jest.fn();
const mockIsAdminUser = jest.fn();
const mockUseConfig = jest.fn();
const mockUseThreads = jest.fn();
const mockSendTelegramMessage = jest.fn();
const mockLog = jest.fn();
const mockSendToHttp = jest.fn();
const mockPublish = jest.fn();
const mockUseLangfuse = jest.fn().mockReturnValue({ trace: null });
const mockRequestGptAnswer = jest.fn();

jest.unstable_mockModule("../../src/helpers/useTools.ts", () => ({
  default: (...args: unknown[]) => mockUseTools(...args),
}));

jest.unstable_mockModule("../../src/telegram/send.ts", () => ({
  sendTelegramMessage: (...args: unknown[]) => mockSendTelegramMessage(...args),
  getFullName: () => "User",
  isAdminUser: (...args: unknown[]) => mockIsAdminUser(...args),
}));

jest.unstable_mockModule("../../src/config.ts", () => ({
  useConfig: () => mockUseConfig(),
}));

jest.unstable_mockModule("../../src/threads.ts", () => ({
  useThreads: () => mockUseThreads(),
}));

jest.unstable_mockModule("../../src/helpers.ts", () => ({
  log: (...args: unknown[]) => mockLog(...args),
  sendToHttp: (...args: unknown[]) => mockSendToHttp(...args),
}));

jest.unstable_mockModule("../../src/mqtt.ts", () => ({
  publishMqttProgress: (...args: unknown[]) => mockPublish(...args),
}));

jest.unstable_mockModule("../../src/helpers/useLangfuse.ts", () => ({
  default: () => mockUseLangfuse(),
}));

jest.unstable_mockModule("../../src/helpers/gpt/llm.ts", () => ({
  requestGptAnswer: (...args: unknown[]) => mockRequestGptAnswer(...args),
}));

let tools: typeof import("../../src/helpers/gpt/tools.ts");

const baseMsg: Message.TextMessage = {
  message_id: 1,
  text: "hi",
  chat: { id: 1, type: "private", title: "chat" },
  from: { username: "user" },
} as Message.TextMessage;

const baseConfig: ConfigChatType = {
  name: "chat",
  agent_name: "agent",
  completionParams: {},
  chatParams: {},
  toolParams: {},
};

beforeEach(async () => {
  jest.resetModules();
  jest.clearAllMocks();
  mockUseConfig.mockReturnValue({ chats: [baseConfig] });
  mockUseThreads.mockReturnValue({ 1: { id: 1, msgs: [], messages: [] } });
  tools = await import("../../src/helpers/gpt/tools.ts");
});

describe("resolveChatTools", () => {
  it("adds change_chat_settings for private chat", async () => {
    mockUseTools.mockResolvedValue([]);
    mockIsAdminUser.mockReturnValue(false);
    const cfg: ConfigChatType = { ...baseConfig, tools: [] };
    const result = await tools.resolveChatTools(baseMsg, cfg);
    expect(cfg.tools).toContain("change_chat_settings");
    expect(result).toEqual([]);
  });

  it("includes global and agent tools", async () => {
    const globalTool = { name: "foo", module: { call: jest.fn() } };
    mockUseTools.mockResolvedValue([globalTool]);
    mockIsAdminUser.mockReturnValue(false);
    const cfg: ConfigChatType = {
      ...baseConfig,
      tools: ["foo", { agent_name: "agent", name: "agent_tool" }],
    };
    const res = await tools.resolveChatTools(baseMsg, cfg);
    expect(res[0]).toBe(globalTool);
    expect(res[1].name).toBe("agent_tool");
  });

  it("skips agent tool for other users", async () => {
    const globalTool = { name: "foo", module: { call: jest.fn() } };
    mockUseTools.mockResolvedValue([globalTool]);
    mockIsAdminUser.mockReturnValue(false);
    mockUseConfig.mockReturnValue({
      chats: [{ ...baseConfig, privateUsers: ["other"] }],
    });
    const cfg: ConfigChatType = {
      ...baseConfig,
      tools: ["foo", { agent_name: "agent", name: "agent_tool" }],
    };
    const res = await tools.resolveChatTools(baseMsg, cfg);
    expect(res).toEqual([globalTool]);
  });
});

describe("getToolsPrompts", () => {
  it("collects prompts from chat tools", async () => {
    const chatTools: ChatToolType[] = [
      {
        name: "a",
        module: {
          call: () => ({ prompt_append: () => "p1" }),
        },
      },
      {
        name: "b",
        module: {
          call: () => ({}),
        },
      },
      {
        name: "c",
        module: {
          call: () => ({ prompt_append: () => "p3" }),
        },
      },
    ];
    const thread: ThreadStateType = { id: 1, msgs: [], messages: [] };
    const prompts = await tools.getToolsPrompts(chatTools, baseConfig, thread);
    expect(prompts).toEqual(["p1", "p3"]);
  });
});

describe("getToolsSystemMessages", () => {
  it("collects system messages from chat tools", async () => {
    const chatTools: ChatToolType[] = [
      {
        name: "a",
        module: {
          call: () => ({ systemMessage: () => "s1" }),
        },
      },
      {
        name: "b",
        module: {
          call: () => ({}),
        },
      },
    ];
    const thread: ThreadStateType = { id: 1, msgs: [], messages: [] };
    const msgs = await tools.getToolsSystemMessages(
      chatTools,
      baseConfig,
      thread,
    );
    expect(msgs).toEqual(["s1"]);
  });
});

describe("executeTools", () => {
  it("returns not found when tool missing", async () => {
    const toolCalls: ChatCompletionMessageToolCall[] = [
      {
        id: "1",
        type: "function",
        function: { name: "missing", arguments: "{}" },
      },
    ];
    const cfg: ConfigChatType = { ...baseConfig, chatParams: {} };
    const res = await tools.executeTools(toolCalls, [], cfg, baseMsg);
    expect(res).toEqual([{ content: "Tool not found: missing" }]);
  });
});
