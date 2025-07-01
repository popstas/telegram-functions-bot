import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Message } from "telegraf/types";
import type { Context } from "telegraf";
import type { ConfigChatType } from "../src/types";

const mockUseTools = jest.fn();
const mockSendTelegramMessage = jest.fn();
const mockWriteConfig = jest.fn();
const mockUseConfig = jest.fn();
const mockGeneratePrivateChatConfig = jest.fn();
const mockGetActionUserMsg = jest.fn();
const mockGetSystemMessage = jest.fn();
const mockGetTokensCount = jest.fn();
const mockResolveChatTools = jest.fn();
const mockForgetHistory = jest.fn();
const mockCommandGoogleOauth = jest.fn();
const mockGetCtxChatMsg = jest.fn();

jest.unstable_mockModule("../src/helpers/useTools.ts", () => ({
  __esModule: true,
  default: () => mockUseTools(),
}));

jest.unstable_mockModule("../src/telegram/send.ts", () => ({
  __esModule: true,
  sendTelegramMessage: (...args: unknown[]) => mockSendTelegramMessage(...args),
  getFullName: () => "",
  getTelegramForwardedUser: () => "",
  isAdminUser: () => true,
  buildButtonRows: () => [],
}));

let actionCb: (ctx: unknown) => Promise<void>;
const mockAction = jest.fn(
  (name: string, cb: (ctx: unknown) => Promise<void>) => {
    actionCb = cb;
  },
);

jest.unstable_mockModule("../src/bot", () => ({
  __esModule: true,
  useBot: () => ({ action: mockAction }),
}));

let config: unknown;

jest.unstable_mockModule("../src/config.ts", () => ({
  __esModule: true,
  useConfig: () => mockUseConfig(),
  writeConfig: (...args: unknown[]) => mockWriteConfig(...args),
  generatePrivateChatConfig: (u: string) => mockGeneratePrivateChatConfig(u),
}));

jest.unstable_mockModule("../src/telegram/context.ts", () => ({
  __esModule: true,
  getActionUserMsg: () => mockGetActionUserMsg(),
  getCtxChatMsg: (...args: unknown[]) => mockGetCtxChatMsg(...args),
}));

jest.unstable_mockModule("../src/helpers/gpt.ts", () => ({
  __esModule: true,
  getSystemMessage: (...args: unknown[]) => mockGetSystemMessage(...args),
  getTokensCount: (...args: unknown[]) => mockGetTokensCount(...args),
  resolveChatTools: (...args: unknown[]) => mockResolveChatTools(...args),
}));

jest.unstable_mockModule("../src/helpers/history.ts", () => ({
  __esModule: true,
  forgetHistory: (...args: unknown[]) => mockForgetHistory(...args),
}));

jest.unstable_mockModule("../src/helpers/google.ts", () => ({
  __esModule: true,
  commandGoogleOauth: (...args: unknown[]) => mockCommandGoogleOauth(...args),
}));

// for getInfoMessage internal call

let commands: typeof import("../src/commands.ts");

beforeEach(async () => {
  jest.resetModules();
  actionCb = async () => {};
  config = {
    adminUsers: ["admin"],
    chats: [] as ConfigChatType[],
  };
  mockUseTools.mockReset();
  mockUseTools.mockResolvedValue([]);
  mockSendTelegramMessage.mockReset();
  mockWriteConfig.mockReset();
  mockUseConfig.mockReset().mockReturnValue(config);
  mockGeneratePrivateChatConfig.mockReset().mockImplementation((u) => ({
    name: `Private ${u}`,
    username: u,
    completionParams: {},
    chatParams: {},
    toolParams: {},
  }));
  mockGetActionUserMsg
    .mockReset()
    .mockReturnValue({ user: { username: "admin" } });
  mockGetSystemMessage.mockReset().mockResolvedValue("sys");
  mockGetTokensCount.mockReset().mockReturnValue(1);
  mockResolveChatTools.mockReset().mockResolvedValue([]);

  commands = await import("../src/commands.ts");
});

function createMsg(username = "user"): Message.TextMessage {
  return {
    chat: { id: 1, type: "private" },
    from: { username },
    text: "hi",
  } as Message.TextMessage;
}

describe("getToolsInfo", () => {
  it("returns available tools descriptions", async () => {
    mockUseTools.mockResolvedValue([
      { name: "foo", module: { description: "Foo" } },
      { name: "bar", module: { description: "Bar" } },
    ]);
    config.chats.push({
      agent_name: "agent1",
      privateUsers: ["user1"],
      completionParams: {},
      chatParams: {},
      toolParams: {},
    });
    const msg = createMsg("user1");
    const res = await commands.getToolsInfo(
      [
        "foo",
        { name: "agentTool", agent_name: "agent1", description: "D" },
        "change_chat_settings",
      ],
      msg,
    );
    expect(res).toEqual(["- foo - Foo", "- agentTool - D"]);
  });

  it("skips agent tool when user not allowed", async () => {
    mockUseTools.mockResolvedValue([
      { name: "foo", module: { description: "Foo" } },
    ]);
    config.chats.push({
      agent_name: "agent1",
      privateUsers: ["user1"],
      completionParams: {},
      chatParams: {},
      toolParams: {},
    });
    const msg = createMsg("other");
    const res = await commands.getToolsInfo(
      ["foo", { name: "agentTool", agent_name: "agent1", description: "D" }],
      msg,
    );
    expect(res).toEqual(["- foo - Foo"]);
  });
});

describe("commandAddTool", () => {
  it("sends list and handles action", async () => {
    mockUseTools.mockResolvedValue([
      { name: "foo", module: { description: "Foo", defaultParams: { p: 1 } } },
    ]);
    const msg = createMsg();
    const chat: ConfigChatType = {
      bot_token: "t",
      completionParams: {},
      chatParams: {},
      toolParams: {},
      name: "c",
    } as ConfigChatType;
    mockSendTelegramMessage.mockResolvedValue("ok");
    const res = await commands.commandAddTool(msg, chat);
    expect(res).toBe("ok");
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      1,
      expect.stringContaining("Available tools"),
      expect.objectContaining({
        reply_markup: {
          inline_keyboard: [[{ text: "foo", callback_data: "add_tool_foo" }]],
        },
      }),
      undefined,
      chat,
    );
    expect(mockAction).toHaveBeenCalledWith(
      "add_tool_foo",
      expect.any(Function),
    );
    const ctxReply = jest.fn();
    await actionCb({ chat: { id: 2, type: "private" }, reply: ctxReply });
    expect(config.chats[0].tools).toContain("foo");
    expect(config.chats[0].toolParams).toEqual({ p: 1 });
    expect(ctxReply).toHaveBeenCalledWith(
      expect.stringContaining("Tool added: foo"),
    );
    expect(mockWriteConfig).toHaveBeenCalled();
  });
});

describe("getInfoMessage", () => {
  it("builds info string", async () => {
    mockUseTools.mockResolvedValue([
      { name: "foo", module: { description: "" } },
    ]);
    const chat: ConfigChatType = {
      name: "c",
      id: 1,
      prefix: "!",
      tools: ["foo"],
      completionParams: { model: "m" },
      chatParams: { forgetTimeout: 10, memoryless: true },
      toolParams: {},
    } as ConfigChatType;
    const msg = createMsg();
    const res = await commands.getInfoMessage(msg, chat);
    expect(mockGetSystemMessage).toHaveBeenCalled();
    expect(res).toContain("System: sys");
    expect(res).toContain("Tokens: 1");
    expect(res).toContain("Model: m");
    expect(res).toContain("Forget timeout: 10");
    expect(res).toContain("Chat is memoryless");
    expect(res).toContain("Tools:\n- foo");
    expect(res).toContain("Настройки приватного режима");
  });
});

describe("handleForget", () => {
  it("forgets history and sends ok", async () => {
    const ctx = { chat: { id: 1 } } as unknown as Context;
    mockSendTelegramMessage.mockResolvedValue("ok");
    await commands.handleForget(ctx);
    expect(mockForgetHistory).toHaveBeenCalledWith(1);
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      1,
      "OK",
      undefined,
      ctx,
    );
  });
});

describe("handleInfo", () => {
  it("sends info message", async () => {
    const ctx = { chat: { id: 1 } } as unknown as Context;
    const msg = createMsg();
    const chat = {
      completionParams: {},
      chatParams: {},
      toolParams: {},
    } as ConfigChatType;
    mockGetCtxChatMsg.mockReturnValue({ msg, chat });
    mockSendTelegramMessage.mockResolvedValue("ok");
    const expected = await commands.getInfoMessage(msg, chat);
    await commands.handleInfo(ctx);
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      1,
      expected,
      undefined,
      ctx,
    );
  });
});

describe("handleGoogleAuth", () => {
  it("calls oauth when data present", async () => {
    const ctx = { chat: { id: 1 } } as unknown as Context;
    const msg = createMsg();
    const chat = {} as ConfigChatType;
    mockGetCtxChatMsg.mockReturnValue({ msg, chat });
    await commands.handleGoogleAuth(ctx);
    expect(mockCommandGoogleOauth).toHaveBeenCalledWith(msg);
  });
});

describe("handleAddTool", () => {
  it("delegates to commandAddTool", async () => {
    const ctx = { chat: { id: 1 } } as unknown as Context;
    const msg = createMsg();
    const chat = {
      completionParams: {},
      chatParams: {},
      toolParams: {},
    } as ConfigChatType;
    mockGetCtxChatMsg.mockReturnValue({ msg, chat });
    await commands.handleAddTool(ctx);
    expect(mockSendTelegramMessage).toHaveBeenCalled();
  });
});
