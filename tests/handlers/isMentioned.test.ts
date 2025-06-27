import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Message } from "telegraf/types";
import type { ConfigChatType } from "../../src/types";

const mockUseConfig = jest.fn();

jest.unstable_mockModule("../../src/config.ts", () => ({
  useConfig: () => mockUseConfig(),
}));

const { isMentioned } = await import("../../src/handlers/access.ts");

function createMsg(opts: Partial<Message.TextMessage>): Message.TextMessage {
  return {
    chat: { id: 1, type: "group" },
    from: { username: "user" },
    message_id: 1,
    date: 0,
    text: "hi",
    ...opts,
  } as Message.TextMessage;
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
  it("returns true when no prefix", () => {
    const chat = { ...baseChat, prefix: undefined } as ConfigChatType;
    const msg = createMsg({ text: "hello" });
    expect(isMentioned(msg, chat)).toBe(true);
  });

  it("detects prefix", () => {
    const msg = createMsg({ text: "!hello" });
    expect(isMentioned(msg, baseChat)).toBe(true);
  });

  it("detects mention", () => {
    const msg = createMsg({ text: "hi @mybot" });
    expect(isMentioned(msg, baseChat)).toBe(true);
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

  it("returns false when reply to other user", () => {
    const msg = createMsg({
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

  it("ignores prefix in private chat", () => {
    const msg = createMsg({ chat: { id: 2, type: "private" }, text: "hello" });
    expect(isMentioned(msg, baseChat)).toBe(true);
  });

  it("returns false for group without mention", () => {
    const msg = createMsg({ text: "hello" });
    expect(isMentioned(msg, baseChat)).toBe(false);
  });
});
