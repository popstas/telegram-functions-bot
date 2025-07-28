import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Context } from "telegraf";
import type { Message, Update } from "telegraf/types";
import type { ConfigChatType } from "../../src/types";
import { createNewContext } from "../../src/telegram/context";

const mockUseConfig = jest.fn();
const mockLog = jest.fn();

jest.unstable_mockModule("../../src/config.ts", () => ({
  useConfig: () => mockUseConfig(),
}));

jest.unstable_mockModule("../../src/helpers.ts", () => ({
  log: (...args: unknown[]) => mockLog(...args),
}));

let getActionUserMsg: typeof import("../../src/telegram/context.ts").getActionUserMsg;
let getCtxChatMsg: typeof import("../../src/telegram/context.ts").getCtxChatMsg;

beforeEach(async () => {
  jest.resetModules();
  mockUseConfig.mockReset();
  mockLog.mockReset();
  const mod = await import("../../src/telegram/context.ts");
  getActionUserMsg = mod.getActionUserMsg;
  getCtxChatMsg = mod.getCtxChatMsg;
});

function createCtx(update?: Partial<Update>, botName = "bot") {
  return {
    ...(update ? { update } : {}),
    botInfo: { username: botName },
  } as unknown as Context;
}

function createMsg(username: string): Message.TextMessage {
  return {
    chat: { id: 123, type: "private", username },
    from: { username },
    text: "hi",
  } as unknown as Message.TextMessage;
}

describe("getActionUserMsg", () => {
  it("returns user and message from callback query", () => {
    const ctx = createCtx({
      callback_query: {
        from: { id: 1, username: "u" },
        message: { text: "hi" },
      },
    });
    const res = getActionUserMsg(ctx);
    expect(res.user).toEqual({ id: 1, username: "u" });
    expect(res.msg).toEqual({ text: "hi" });
  });

  it("returns empty object when no callback", () => {
    const res = getActionUserMsg(createCtx());
    expect(res).toEqual({});
  });
});

describe("getCtxChatMsg", () => {
  const baseChat: ConfigChatType = {
    id: 123,
    name: "default",
    completionParams: {},
    chatParams: {},
    toolParams: {},
  } as ConfigChatType;

  it("returns chat when user allowed", () => {
    mockUseConfig.mockReturnValue({ chats: [baseChat], privateUsers: [] });
    const ctx = createCtx({ message: createMsg("u") });
    const { chat, msg } = getCtxChatMsg(ctx);
    expect(chat).toMatchObject(baseChat);
    expect(msg?.text).toBe("hi");
  });

  it("ignores case when checking private users", () => {
    mockUseConfig.mockReturnValue({
      chats: [{ ...baseChat, privateUsers: ["User"] }],
      privateUsers: [],
    });
    const ctx = createCtx({ message: createMsg("user") });
    const { chat } = getCtxChatMsg(ctx);
    expect(chat).toMatchObject(baseChat);
  });

  it("returns undefined chat when user not allowed", () => {
    mockUseConfig.mockReturnValue({
      chats: [{ ...baseChat, privateUsers: ["other"] }],
      privateUsers: [],
    });
    // use different chat id to trigger access check
    const ctx = createCtx({
      message: {
        ...createMsg("u"),
        chat: { id: 999, type: "private", username: "u" },
      },
    });
    const { chat } = getCtxChatMsg(ctx);
    expect(chat).toBeUndefined();
  });

  it("allows admin users", () => {
    mockUseConfig.mockReturnValue({
      chats: [baseChat],
      privateUsers: [],
      adminUsers: ["admin"],
    });
    const ctx = createCtx({ message: createMsg("admin") });
    const { chat } = getCtxChatMsg(ctx);
    expect(chat).toMatchObject(baseChat);
  });
});

describe("createNewContext", () => {
  it("creates new context with new message", () => {
    const ctx = createCtx({ message: createMsg("u") });
    const newMsg = createMsg("new");
    const newCtx = createNewContext(ctx, newMsg);
    expect(newCtx.message).toEqual(newMsg);
    expect(newCtx.update).toEqual({ message: newMsg });
  });
});
