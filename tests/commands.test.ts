import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Message } from "grammy/types";
import type { Context } from "telegraf";
import type { ConfigChatType } from "../src/types.ts";

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

const mockLoadSkills = jest.fn();

jest.unstable_mockModule("../src/helpers/skills.ts", () => ({
  __esModule: true,
  loadSkills: () => mockLoadSkills(),
  skillToolName: (skill: { name: string }) =>
    `skill_${skill.name.toLowerCase().replace(/[^a-z0-9_]+/g, "_")}`,
}));

jest.unstable_mockModule("../src/telegram/send.ts", () => ({
  __esModule: true,
  sendTelegramMessage: (...args: unknown[]) => mockSendTelegramMessage(...args),
  getFullName: () => "",
  getTelegramForwardedUser: () => "",
  isAdminUser: () => true,
  buildButtonRows: () => [],
}));

function createFakeBot() {
  return { action: jest.fn() };
}

let config: unknown;

const mockReadConfig = jest.fn();

jest.unstable_mockModule("../src/config.ts", () => ({
  __esModule: true,
  useConfig: () => mockUseConfig(),
  writeConfig: (...args: unknown[]) => mockWriteConfig(...args),
  generatePrivateChatConfig: (u: string) => mockGeneratePrivateChatConfig(u),
  readConfig: () => mockReadConfig(),
  updateChatInConfig: jest.fn(),
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
  config = {
    adminUsers: ["admin"],
    chats: [] as ConfigChatType[],
  };
  mockUseTools.mockReset();
  mockUseTools.mockResolvedValue([]);
  mockSendTelegramMessage.mockReset();
  mockWriteConfig.mockReset();
  mockReadConfig.mockReset();
  mockReadConfig.mockReturnValue(config);
  mockUseConfig.mockReset().mockReturnValue(config);
  mockGeneratePrivateChatConfig.mockReset().mockImplementation((u) => ({
    name: `Private ${u}`,
    username: u,
    completionParams: {},
    chatParams: {},
    toolParams: {},
  }));
  mockGetActionUserMsg.mockReset().mockReturnValue({ user: { username: "admin" } });
  mockGetSystemMessage.mockReset().mockResolvedValue("sys");
  mockGetTokensCount.mockReset().mockReturnValue(1);
  mockResolveChatTools.mockReset().mockResolvedValue([]);
  mockLoadSkills.mockReset().mockReturnValue([]);

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
    mockUseTools.mockResolvedValue([{ name: "foo", module: { description: "Foo" } }]);
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
  it("sends list of available tools", async () => {
    mockUseTools.mockResolvedValue([
      { name: "foo", module: { description: "Foo", defaultParams: { p: 1 } } },
    ]);
    const msg = createMsg("admin");
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
  });

  it("ignores a non-admin invocation before listing tools", async () => {
    mockUseTools.mockResolvedValue([{ name: "foo", module: { description: "Foo" } }]);
    const msg = createMsg("intruder");
    const chat: ConfigChatType = {
      bot_token: "t",
      completionParams: {},
      chatParams: {},
      toolParams: {},
      name: "c",
    } as ConfigChatType;
    const res = await commands.commandAddTool(msg, chat);
    expect(res).toBeUndefined();
    expect(mockSendTelegramMessage).not.toHaveBeenCalled();
  });
});

describe("commandAddSkill", () => {
  it("sends skill list", async () => {
    mockLoadSkills.mockReturnValue([
      { name: "greet", description: "Greet skill", dir: "/s/greet" },
    ]);
    const msg = createMsg("admin");
    const chat: ConfigChatType = {
      bot_token: "t",
      completionParams: {},
      chatParams: {},
      toolParams: {},
      name: "c",
    } as ConfigChatType;
    mockSendTelegramMessage.mockResolvedValue("ok");
    const res = await commands.commandAddSkill(msg, chat);
    expect(res).toBe("ok");
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      1,
      expect.stringContaining("Available skills"),
      expect.objectContaining({
        reply_markup: {
          inline_keyboard: [[{ text: "skill_greet", callback_data: "add_skill_skill_greet" }]],
        },
      }),
      undefined,
      chat,
    );
  });

  it("replies with helpful message when no skills found", async () => {
    mockLoadSkills.mockReturnValue([]);
    const msg = createMsg("admin");
    const chat: ConfigChatType = {
      bot_token: "t",
      completionParams: {},
      chatParams: {},
      toolParams: {},
      name: "c",
    } as ConfigChatType;
    mockSendTelegramMessage.mockResolvedValue("none");
    const res = await commands.commandAddSkill(msg, chat);
    expect(res).toBe("none");
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      1,
      expect.stringContaining("No skills found"),
      undefined,
      undefined,
      chat,
    );
  });

  it("ignores a non-admin invocation before listing skills", async () => {
    mockLoadSkills.mockReturnValue([{ name: "greet", description: "G", dir: "/s/greet" }]);
    const msg = createMsg("intruder");
    const chat: ConfigChatType = {
      bot_token: "t",
      completionParams: {},
      chatParams: {},
      toolParams: {},
      name: "c",
    } as ConfigChatType;
    const res = await commands.commandAddSkill(msg, chat);
    expect(res).toBeUndefined();
    expect(mockSendTelegramMessage).not.toHaveBeenCalled();
    expect(mockLoadSkills).not.toHaveBeenCalled();
  });
});

describe("registerCommandActions", () => {
  let fakeBot: ReturnType<typeof createFakeBot>;
  let addToolHandler: (ctx: unknown) => Promise<void>;
  let addSkillHandler: (ctx: unknown) => Promise<void>;

  beforeEach(() => {
    fakeBot = createFakeBot();
    commands.registerCommandActions(
      fakeBot as unknown as Parameters<typeof commands.registerCommandActions>[0],
    );
    const toolCall = fakeBot.action.mock.calls.find(([re]) =>
      (re as RegExp).source.startsWith("^add_tool_"),
    );
    const skillCall = fakeBot.action.mock.calls.find(([re]) =>
      (re as RegExp).source.startsWith("^add_skill_"),
    );
    addToolHandler = toolCall![1] as (ctx: unknown) => Promise<void>;
    addSkillHandler = skillCall![1] as (ctx: unknown) => Promise<void>;
  });

  describe("add_tool_<name>", () => {
    it("adds tool to chat config and answers the callback query", async () => {
      mockUseTools.mockResolvedValue([
        { name: "foo", module: { description: "Foo", defaultParams: { p: 1 } } },
      ]);
      const ctxReply = jest.fn();
      const answerCbQuery = jest.fn();
      await addToolHandler({
        match: ["add_tool_foo", "foo"],
        chat: { id: 2, type: "private" },
        reply: ctxReply,
        answerCbQuery,
        update: { callback_query: { from: { username: "admin" }, message: { chat: { id: 2 } } } },
      });
      expect(config.chats[0].tools).toContain("foo");
      expect(config.chats[0].toolParams).toEqual({ p: 1 });
      expect(ctxReply).toHaveBeenCalledWith(expect.stringContaining("Tool added: foo"));
      expect(mockWriteConfig).toHaveBeenCalled();
      expect(answerCbQuery).toHaveBeenCalledWith();
      expect(answerCbQuery).toHaveBeenCalledTimes(1);
    });

    it("answers 'Unknown tool' for a stale button and does not write config", async () => {
      mockUseTools.mockResolvedValue([]);
      const answerCbQuery = jest.fn();
      await addToolHandler({
        match: ["add_tool_nonexistent", "nonexistent"],
        chat: { id: 2, type: "private" },
        reply: jest.fn(),
        answerCbQuery,
        update: { callback_query: { from: { username: "admin" }, message: { chat: { id: 2 } } } },
      });
      expect(answerCbQuery).toHaveBeenCalledWith("Unknown tool");
      expect(answerCbQuery).toHaveBeenCalledTimes(1);
      expect(mockWriteConfig).not.toHaveBeenCalled();
    });
  });

  describe("add_skill_<name>", () => {
    it("adds skill to chat config and answers the callback query", async () => {
      mockLoadSkills.mockReturnValue([{ name: "greet", description: "G", dir: "/s/greet" }]);
      const ctxReply = jest.fn();
      const answerCbQuery = jest.fn();
      await addSkillHandler({
        match: ["add_skill_skill_greet", "skill_greet"],
        chat: { id: 2, type: "private" },
        reply: ctxReply,
        answerCbQuery,
        update: { callback_query: { from: { username: "admin" }, message: { chat: { id: 2 } } } },
      });
      expect(config.chats[0].tools).toContain("skill_greet");
      expect(ctxReply).toHaveBeenCalledWith("Skill added: skill_greet");
      expect(mockWriteConfig).toHaveBeenCalled();
      expect(answerCbQuery).toHaveBeenCalledWith();
    });

    it("answers 'Unknown skill' for a stale button and does not write config", async () => {
      mockLoadSkills.mockReturnValue([]);
      const answerCbQuery = jest.fn();
      await addSkillHandler({
        match: ["add_skill_nonexistent", "nonexistent"],
        chat: { id: 2, type: "private" },
        reply: jest.fn(),
        answerCbQuery,
        update: { callback_query: { from: { username: "admin" }, message: { chat: { id: 2 } } } },
      });
      expect(answerCbQuery).toHaveBeenCalledWith("Unknown skill");
      expect(answerCbQuery).toHaveBeenCalledTimes(1);
      expect(mockWriteConfig).not.toHaveBeenCalled();
    });

    it("ignores non-admin tap", async () => {
      mockLoadSkills.mockReturnValue([{ name: "greet", description: "G", dir: "/s/greet" }]);
      mockGetActionUserMsg.mockReturnValue({ user: { username: "intruder" } });
      const ctxReply = jest.fn();
      await addSkillHandler({
        match: ["add_skill_skill_greet", "skill_greet"],
        chat: { id: 2, type: "private" },
        reply: ctxReply,
        answerCbQuery: jest.fn(),
        update: {
          callback_query: { from: { username: "intruder" }, message: { chat: { id: 2 } } },
        },
      });
      expect(config.chats.length).toBe(0);
      expect(ctxReply).not.toHaveBeenCalled();
      expect(mockWriteConfig).not.toHaveBeenCalled();
    });

    it("adds a skill to a matching group chat", async () => {
      mockLoadSkills.mockReturnValue([{ name: "greet", description: "G", dir: "/s/greet" }]);
      config.chats.push({
        id: 2,
        tools: [],
        completionParams: {},
        chatParams: {},
        toolParams: {},
      });
      const ctxReply = jest.fn();
      await addSkillHandler({
        match: ["add_skill_skill_greet", "skill_greet"],
        chat: { id: 2, type: "supergroup" },
        reply: ctxReply,
        answerCbQuery: jest.fn(),
        update: { callback_query: { from: { username: "admin" }, message: { chat: { id: 2 } } } },
      });
      expect(config.chats[0].tools).toContain("skill_greet");
      expect(ctxReply).toHaveBeenCalledWith("Skill added: skill_greet");
      expect(mockWriteConfig).toHaveBeenCalled();
    });

    it("replies 'Chat not found in config' for an unconfigured group chat", async () => {
      mockLoadSkills.mockReturnValue([{ name: "greet", description: "G", dir: "/s/greet" }]);
      const ctxReply = jest.fn();
      await addSkillHandler({
        match: ["add_skill_skill_greet", "skill_greet"],
        chat: { id: 999, type: "supergroup" },
        reply: ctxReply,
        answerCbQuery: jest.fn(),
        update: { callback_query: { from: { username: "admin" }, message: { chat: { id: 999 } } } },
      });
      expect(ctxReply).toHaveBeenCalledWith("Chat not found in config");
      expect(mockWriteConfig).not.toHaveBeenCalled();
    });

    it("does not add a duplicate skill", async () => {
      mockLoadSkills.mockReturnValue([{ name: "greet", description: "G", dir: "/s/greet" }]);
      config.chats.push({
        username: "admin",
        tools: ["skill_greet"],
        completionParams: {},
        chatParams: {},
        toolParams: {},
      });
      const ctxReply = jest.fn();
      await addSkillHandler({
        match: ["add_skill_skill_greet", "skill_greet"],
        chat: { id: 2, type: "private" },
        reply: ctxReply,
        answerCbQuery: jest.fn(),
        update: { callback_query: { from: { username: "admin" }, message: { chat: { id: 2 } } } },
      });
      expect(config.chats[0].tools).toEqual(["skill_greet"]);
      expect(ctxReply).toHaveBeenCalledWith("Skill already added: skill_greet");
      expect(mockWriteConfig).not.toHaveBeenCalled();
    });
  });
});

describe("handleAddSkill", () => {
  it("delegates to commandAddSkill", async () => {
    mockLoadSkills.mockReturnValue([{ name: "greet", description: "G", dir: "/s/greet" }]);
    const ctx = { chat: { id: 1 } } as unknown as Context;
    const msg = createMsg("admin");
    const chat = {
      bot_token: "t",
      completionParams: {},
      chatParams: {},
      toolParams: {},
    } as ConfigChatType;
    mockGetCtxChatMsg.mockReturnValue({ msg, chat });
    await commands.handleAddSkill(ctx);
    expect(mockSendTelegramMessage).toHaveBeenCalled();
  });
});

describe("getInfoMessage", () => {
  it("builds info string", async () => {
    mockUseTools.mockResolvedValue([{ name: "foo", module: { description: "" } }]);
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

  it("shows streaming status when streaming is enabled", async () => {
    mockUseTools.mockResolvedValue([]);
    const msg = createMsg();
    const streamingChat: ConfigChatType = {
      name: "c",
      completionParams: { model: "m" },
      chatParams: { streaming: true },
      toolParams: {},
    } as ConfigChatType;
    expect(await commands.getInfoMessage(msg, streamingChat)).toContain("Streaming: yes");
  });
});

describe("handleForget", () => {
  it("forgets history and sends ok", async () => {
    const ctx = { chat: { id: 1 } } as unknown as Context;
    mockSendTelegramMessage.mockResolvedValue("ok");
    await commands.handleForget(ctx);
    expect(mockForgetHistory).toHaveBeenCalledWith(1);
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(1, "OK", undefined, ctx);
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
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(1, expected, undefined, ctx);
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
    const msg = createMsg("admin");
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

describe("handleAddChat", () => {
  it("adds chat to config and replies", async () => {
    const ctx = {
      chat: { id: 5, title: "t" },
      reply: jest.fn(),
    } as unknown as Context;
    await commands.handleAddChat(ctx);
    expect(config.chats[0]).toEqual({ name: "t", id: 5 });
    expect(mockWriteConfig).toHaveBeenCalledWith(undefined, config);
    expect(ctx.reply).toHaveBeenCalledWith("Chat added: t");
  });
});

describe("handleStart", () => {
  it("stores vars from deeplink", async () => {
    const ctx = {
      chat: { id: 1 },
      startPayload: Buffer.from("from:pop").toString("base64"),
    } as unknown as Context & {
      startPayload?: string;
    };
    const msg = createMsg();
    const chat: ConfigChatType = {
      id: 1,
      completionParams: {},
      chatParams: {},
      toolParams: {},
      deeplinks: [{ name: "from" }],
    } as ConfigChatType;
    mockGetCtxChatMsg.mockReturnValue({ msg, chat });
    (config as { chats: ConfigChatType[] }).chats.push(chat);
    await commands.handleStart(ctx);
    expect(mockReadConfig).toHaveBeenCalled();
    expect(mockWriteConfig).toHaveBeenCalledWith(undefined, config);
    expect((config as { chats: ConfigChatType[] }).chats[0].user_vars?.[0]).toEqual({
      username: "user",
      vars: { from: "pop" },
    });
  });
});
