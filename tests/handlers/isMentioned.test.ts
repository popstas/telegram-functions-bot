import { jest, describe, it, beforeEach, expect } from "@jest/globals";
import type { Message } from "telegraf/types";
import type { ConfigChatType } from "../../src/types";

const mockUseConfig = jest.fn();

jest.unstable_mockModule("../../src/config.ts", () => ({
  useConfig: () => mockUseConfig(),
}));

const { isMentioned } = await import("../../src/handlers/access.ts");

type TxtMsg = Message.TextMessage & { caption?: string };
function createMsg(opts: Partial<TxtMsg> = {}): TxtMsg {
  return {
    chat: { id: 1, type: "group" },
    from: { username: "user" },
    message_id: 1,
    date: 0,
    text: "hi",
    ...opts,
  } as TxtMsg;
}

const baseChat: ConfigChatType = {
  name: "chat",
  prefix: "!",
  completionParams: {},
  chatParams: {},
  toolParams: {},
} as ConfigChatType;

beforeEach(() => {
  jest.clearAllMocks();
  mockUseConfig.mockReturnValue({ bot_name: "mybot" });
});

describe("isMentioned", () => {
  it("returns true in private chat", () => {
    const msg = createMsg({ chat: { id: 2, type: "private" }, text: "hello" });
    expect(isMentioned(msg, baseChat)).toBe(true);
  });

  it("returns true when no prefix and not a reply", () => {
    const chat = { ...baseChat, prefix: undefined } as ConfigChatType;
    const msg = createMsg({ text: "hello" });
    expect(isMentioned(msg, chat)).toBe(true);
  });

  it("returns false when no prefix and reply to other", () => {
    const chat = { ...baseChat, prefix: undefined } as ConfigChatType;
    const msg = createMsg({
      reply_to_message: {
        chat: { id: 1, type: "group" },
        from: { username: "other" },
        message_id: 2,
        date: 0,
        text: "hi",
      } as Message.TextMessage,
    });
    expect(isMentioned(msg, chat)).toBe(false);
  });

  it("detects prefix case-insensitively", () => {
    const msg = createMsg({ text: "!HELLO" });
    expect(isMentioned(msg, baseChat)).toBe(true);
  });

  it("detects mention case-insensitively", () => {
    const msg = createMsg({ text: "hi @MYBOT" });
    expect(isMentioned(msg, baseChat)).toBe(true);
  });

  it("uses caption when text missing", () => {
    const msg = createMsg({ text: undefined, caption: "!go", photo: [] });
    expect(isMentioned(msg, baseChat)).toBe(true);
  });

  it("uses chat bot_name when provided", () => {
    const chat = { ...baseChat, bot_name: "other" } as ConfigChatType;
    const msg = createMsg({ text: "hi @other" });
    expect(isMentioned(msg, chat)).toBe(true);
  });

  it("detects reply to bot", () => {
    const msg = createMsg({
      reply_to_message: {
        chat: { id: 1, type: "group" },
        from: { username: "mybot" },
        message_id: 2,
        date: 0,
        text: "bot",
      } as Message.TextMessage,
    });
    expect(isMentioned(msg, baseChat)).toBe(true);
  });

  it("ignores prefix when replying to other", () => {
    const msg = createMsg({
      text: "!hello",
      reply_to_message: {
        chat: { id: 1, type: "group" },
        from: { username: "other" },
        message_id: 2,
        date: 0,
        text: "hi",
      } as Message.TextMessage,
    });
    expect(isMentioned(msg, baseChat)).toBe(false);
  });

  it("returns false for group without mention", () => {
    const msg = createMsg({ text: "hello" });
    expect(isMentioned(msg, baseChat)).toBe(false);
  });
});
