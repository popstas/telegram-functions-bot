import { jest, describe, it, beforeEach, expect } from "@jest/globals";
import path from "node:path";
import type { Message } from "telegraf/types";
import type { ConfigChatType, ChatToolType, ThreadStateType } from "../../src/types.ts";
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
const mockUseBot = jest.fn(() => ({
  action: jest.fn((_, cb) => cb()),
  telegram: { sendMessage: jest.fn() },
}));
const mockTelegramConfirm = jest.fn();

jest.unstable_mockModule("../../src/helpers/useTools.ts", () => ({
  default: (...args: unknown[]) => mockUseTools(...args),
}));

jest.unstable_mockModule("../../src/telegram/send.ts", () => ({
  sendTelegramMessage: (...args: unknown[]) => mockSendTelegramMessage(...args),
  sendTelegramDocument: jest.fn(),
  getFullName: () => "User",
  isAdminUser: (...args: unknown[]) => mockIsAdminUser(...args),
}));

jest.unstable_mockModule("../../src/config.ts", () => ({
  useConfig: () => mockUseConfig(),
  updateChatInConfig: jest.fn(),
}));

jest.unstable_mockModule("../../src/threads.ts", () => ({
  useThreads: () => mockUseThreads(),
}));

jest.unstable_mockModule("../../src/helpers.ts", () => ({
  __esModule: true,
  log: (...args: unknown[]) => mockLog(...args),
  sendToHttp: (...args: unknown[]) => mockSendToHttp(...args),
  safeFilename: jest.fn((v) => v),
  stringToId: jest.fn(),
  ensureDirectoryExists: jest.fn(),
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

jest.unstable_mockModule("../../src/bot.ts", () => ({
  useBot: () => mockUseBot(),
}));

jest.unstable_mockModule("../../src/telegram/confirm.ts", () => ({
  telegramConfirm: (...args: unknown[]) => mockTelegramConfirm(...args),
  default: (...args: unknown[]) => mockTelegramConfirm(...args),
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
  mockTelegramConfirm.mockImplementation(async ({ onConfirm }) => onConfirm());
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
    const msgs = await tools.getToolsSystemMessages(chatTools, baseConfig, thread);
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

  it("formats expertizeme search params and calls tool", async () => {
    const toolCalls: ChatCompletionMessageToolCall[] = [
      {
        id: "1",
        type: "function",
        function: {
          name: "expertizeme_search_items",
          arguments: JSON.stringify({
            query: "foo",
            filters: [{ field: "title", operator: "not", value: ["a", "b"] }],
            sortField: "date",
            sortDirection: "desc",
            groupBy: "author",
          }),
        },
      },
    ];

    const toolFn = jest.fn().mockResolvedValue({ content: "ok" });
    const chatTools: ChatToolType[] = [
      {
        name: "expertizeme_search_items",
        module: {
          description: "",
          call: () => ({
            functions: { get: () => toolFn, toolSpecs: { function: {} } },
          }),
        },
      },
    ];
    const cfg: ConfigChatType = { ...baseConfig, chatParams: {} };
    await tools.executeTools(toolCalls, chatTools, cfg, baseMsg);
    expect(toolFn).toHaveBeenCalledTimes(1);
    const callArgs = mockSendToHttp.mock.calls[0];
    expect(callArgs[1]).toContain("**Title**: not a or b");
  });

  it("retries tool once on 400 error", async () => {
    const toolCalls: ChatCompletionMessageToolCall[] = [
      {
        id: "1",
        type: "function",
        function: { name: "foo", arguments: "{}" },
      },
    ];
    const error = new Error("Invalid parameter");
    (error as Error & { status: number }).status = 400;
    const toolFn = jest.fn().mockRejectedValueOnce(error).mockResolvedValue({ content: "done" });
    const chatTools: ChatToolType[] = [
      {
        name: "foo",
        module: {
          description: "",
          call: () => ({
            functions: { get: () => toolFn, toolSpecs: { function: {} } },
          }),
        },
      },
    ];
    const cfg: ConfigChatType = { ...baseConfig, chatParams: {} };
    const res = await tools.executeTools(toolCalls, chatTools, cfg, baseMsg);
    expect(res[0].content).toBe("done");
    expect(toolFn).toHaveBeenCalledTimes(2);
  });

  it("applies noconfirm and confirm flag from message", async () => {
    const toolCalls: ChatCompletionMessageToolCall[] = [
      {
        id: "1",
        type: "function",
        function: { name: "foo", arguments: "{}" },
      },
    ];
    const toolFn = jest.fn().mockResolvedValue({ content: "ok" });
    const callMock = jest.fn(() => ({
      functions: { get: () => toolFn, toolSpecs: { function: {} } },
    }));
    const chatTools: ChatToolType[] = [
      { name: "foo", module: { description: "", call: callMock } },
    ];
    const cfg: ConfigChatType = {
      ...baseConfig,
      chatParams: { confirmation: true },
    };
    const msg = { ...baseMsg, text: "noconfirm run" };
    await tools.executeTools(toolCalls, chatTools, cfg, msg);
    expect(callMock).toHaveBeenCalled();
    const passedCfg = callMock.mock.calls[0][0];
    expect(passedCfg.chatParams.confirmation).toBe(false);
    expect(msg.text.trim()).toBe("run");

    msg.text = "confirm run";
    mockTelegramConfirm.mockImplementation(async ({ onConfirm }) => onConfirm());
    await tools.executeTools(toolCalls, chatTools, cfg, msg);
    expect(callMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    const hasConfirmTrue = callMock.mock.calls.some(
      ([cfg]) => cfg.chatParams.confirmation === true,
    );
    expect(hasConfirmTrue).toBe(true);
    const passedCfgAfter = callMock.mock.calls[callMock.mock.calls.length - 1][0];
    expect(passedCfgAfter.chatParams.confirmation).toBe(false);
    expect(msg.text.trim()).toBe("run");
  });

  it("executes tool after confirmation", async () => {
    const toolCalls: ChatCompletionMessageToolCall[] = [
      {
        id: "1",
        type: "function",
        function: { name: "foo", arguments: "{}" },
      },
    ];
    const chatTools: ChatToolType[] = [
      {
        name: "foo",
        module: {
          description: "",
          call: () => ({
            functions: {
              get: () => jest.fn().mockResolvedValue({ content: "ok" }),
              toolSpecs: { function: {} },
            },
          }),
        },
      },
    ];
    const cfg: ConfigChatType = {
      ...baseConfig,
      chatParams: { confirmation: true },
    };
    const msg = { ...baseMsg };
    const result = tools.executeTools(toolCalls, chatTools, cfg, msg);
    await expect(result).resolves.toEqual([{ content: "ok" }]);
    expect(mockTelegramConfirm).toHaveBeenCalled();
  });

  it("returns cancellation metadata when confirmation rejected", async () => {
    const toolCalls: ChatCompletionMessageToolCall[] = [
      {
        id: "1",
        type: "function",
        function: { name: "foo", arguments: JSON.stringify({ value: 1 }) },
      },
    ];
    const chatTools: ChatToolType[] = [
      {
        name: "foo",
        module: {
          description: "",
          call: () => ({
            functions: {
              get: () => jest.fn().mockResolvedValue({ content: "ok" }),
              toolSpecs: { function: {} },
            },
          }),
        },
      },
    ];
    const cfg: ConfigChatType = {
      ...baseConfig,
      chatParams: { confirmation: true },
    };
    const msg = { ...baseMsg };
    mockTelegramConfirm.mockImplementation(async ({ onCancel }) => onCancel());
    const result = await tools.executeTools(toolCalls, chatTools, cfg, msg);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
    const meta = result as typeof result & { cancelled?: boolean; cancelMessages?: string[] };
    expect(meta.cancelled).toBe(true);
    expect(meta.cancelMessages?.[0]).toContain('"name":"foo"');
  });

  it("appends full text for planfix_add_to_lead_task", async () => {
    const toolCalls: ChatCompletionMessageToolCall[] = [
      {
        id: "1",
        type: "function",
        function: {
          name: "planfix_add_to_lead_task",
          arguments: JSON.stringify({ description: "start" }),
        },
      },
    ];
    mockUseThreads.mockReturnValue({
      1: {
        id: 1,
        msgs: [{ from: { username: "foo" } }],
        messages: [
          { role: "user", content: "hi" },
          { role: "system", content: "sys" },
        ],
      },
    });
    const toolFn = jest.fn().mockResolvedValue({ content: "ok" });
    const chatTools: ChatToolType[] = [
      {
        name: "planfix_add_to_lead_task",
        module: {
          description: "",
          call: () => ({
            functions: { get: () => toolFn, toolSpecs: { function: {} } },
          }),
        },
      },
    ];
    const cfg: ConfigChatType = { ...baseConfig, chatParams: {} };
    await tools.executeTools(toolCalls, chatTools, cfg, baseMsg);
    const arg = toolFn.mock.calls[0][0];
    expect(JSON.parse(arg).description).toContain("Полный текст:");
  });

  it("cleans take_screenshot params before calling tool", async () => {
    const toolCalls: ChatCompletionMessageToolCall[] = [
      {
        id: "1",
        type: "function",
        function: {
          name: "take_screenshot",
          arguments: JSON.stringify({
            format: "png",
            quality: 80,
            uid: "node-1",
            fullPage: true,
          }),
        },
      },
    ];

    const toolFn = jest.fn().mockResolvedValue({ content: "ok" });
    const chatTools: ChatToolType[] = [
      {
        name: "take_screenshot",
        module: {
          description: "",
          call: () => ({
            functions: { get: () => toolFn, toolSpecs: { function: {} } },
          }),
        },
      },
    ];

    const cfg: ConfigChatType = { ...baseConfig, chatParams: {} };
    await tools.executeTools(toolCalls, chatTools, cfg, baseMsg);

    expect(toolFn).toHaveBeenCalledTimes(1);
    const passedArgs = JSON.parse(toolFn.mock.calls[0][0]);
    expect(passedArgs).toEqual({
      format: "png",
      fullPage: true,
      filePath: path.resolve("data", "screenshots", "screenshot.png"),
    });
  });

  it("generates filePath from url for take_screenshot", async () => {
    const toolCalls: ChatCompletionMessageToolCall[] = [
      {
        id: "1",
        type: "function",
        function: {
          name: "take_screenshot",
          arguments: JSON.stringify({
            format: "jpeg",
            url: "https://Example.com/some/path?q=1",
            fullPage: false,
          }),
        },
      },
    ];

    const toolFn = jest.fn().mockResolvedValue({ content: "ok" });
    const chatTools: ChatToolType[] = [
      {
        name: "take_screenshot",
        module: {
          description: "",
          call: () => ({
            functions: { get: () => toolFn, toolSpecs: { function: {} } },
          }),
        },
      },
    ];

    const cfg: ConfigChatType = { ...baseConfig, chatParams: {} };
    await tools.executeTools(toolCalls, chatTools, cfg, baseMsg);

    expect(toolFn).toHaveBeenCalledTimes(1);
    const passedArgs = JSON.parse(toolFn.mock.calls[0][0]);
    expect(passedArgs.filePath).toBe(
      path.resolve("data", "screenshots", "example_com_some_path_q_1.jpg"),
    );
  });
});

describe("chatAsTool", () => {
  it("throws when agent missing", () => {
    mockUseConfig.mockReturnValue({ chats: [] });
    const msg = { ...baseMsg };
    const chatTool = tools.chatAsTool({
      agent_name: "missing",
      name: "tool",
      description: "d",
      msg,
      prompt_append: "",
    });
    expect(() => chatTool.module.call(baseConfig, { id: 1 } as ThreadStateType)).toThrow(
      "Agent not found: missing",
    );
  });

  it("sends answer and stops on first tool", async () => {
    const agentCfg = { ...baseConfig, agent_name: "agent2" };
    mockUseConfig.mockReturnValue({ chats: [agentCfg] });
    mockRequestGptAnswer.mockResolvedValue({ content: "hi" });
    const msg: Message.TextMessage = { ...baseMsg, text: "q" };
    const chatTool = tools.chatAsTool({
      agent_name: "agent2",
      name: "tool",
      description: "d",
      tool_use_behavior: "stop_on_first_tool",
      prompt_append: "",
      msg,
    });
    const module = chatTool.module.call(baseConfig, {
      id: 1,
    } as ThreadStateType);
    const fn = module.functions.get();
    const res = await fn('{"input":"hi"}');
    expect(res.content).toBe("");
    expect(mockRequestGptAnswer).toHaveBeenCalledWith(msg, agentCfg);
    expect(mockSendTelegramMessage).toHaveBeenCalledTimes(3);
    const lastCall = mockSendTelegramMessage.mock.calls.pop();
    expect(lastCall[4]).toBe(baseConfig);
  });
});

describe("prettifyKeyValue", () => {
  it("formats nested values", () => {
    const result = tools.prettifyKeyValue("foo_bar", { a: 1, arr: [2] });
    expect(result).toContain("*Foo bar:*");
    expect(result).toContain("*A:* 1");
    expect(result).toContain("*0:* 2");
  });
});

describe("removeNullsParams", () => {
  it("removes null values and keeps non-null values", () => {
    const input = JSON.stringify({
      addAdmin: ["asd"],
      removeAdmin: null,
      addPrivate: null,
      removePrivate: null,
    });

    const result = tools.removeNullsParams(input);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({
      addAdmin: ["asd"],
    });
    expect(parsed).not.toHaveProperty("removeAdmin");
    expect(parsed).not.toHaveProperty("addPrivate");
    expect(parsed).not.toHaveProperty("removePrivate");
  });

  it("handles empty object", () => {
    const input = JSON.stringify({});
    const result = tools.removeNullsParams(input);
    expect(JSON.parse(result)).toEqual({});
  });

  it("handles object with all null values", () => {
    const input = JSON.stringify({
      a: null,
      b: null,
      c: null,
    });
    const result = tools.removeNullsParams(input);
    expect(JSON.parse(result)).toEqual({});
  });

  it("preserves non-null values of different types", () => {
    const input = JSON.stringify({
      string: "value",
      number: 42,
      boolean: true,
      array: [1, 2, 3],
      object: { nested: "value" },
      nullValue: null,
      undefinedValue: undefined,
    });

    const result = tools.removeNullsParams(input);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({
      string: "value",
      number: 42,
      boolean: true,
      array: [1, 2, 3],
      object: { nested: "value" },
      undefinedValue: undefined,
    });
    expect(parsed).not.toHaveProperty("nullValue");
  });
});
