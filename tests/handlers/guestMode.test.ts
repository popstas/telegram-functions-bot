import { jest, describe, it, beforeEach, expect } from "@jest/globals";
import type { Message } from "telegraf/types";
import type { ConfigChatType, ConfigType } from "../../src/types.ts";

const mockUseConfig = jest.fn();

jest.unstable_mockModule("../../src/config.ts", () => ({
  useConfig: () => mockUseConfig(),
  updateChatInConfig: jest.fn(),
}));

const { isGuestModeReply } = await import("../../src/handlers/access.ts");

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

function otherReply(): Message.TextMessage {
  return {
    chat: { id: 1, type: "group" },
    from: { username: "other", first_name: "Other" },
    message_id: 2,
    date: 0,
    text: "original question",
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
  mockUseConfig.mockReturnValue({
    bot_name: "mybot",
    guestMode: { prompt: "guest prompt" },
  } as Partial<ConfigType>);
});

describe("isGuestModeReply", () => {
  it("returns true when bot tagged in reply to another user", () => {
    const msg = createMsg({ text: "hi @mybot", reply_to_message: otherReply() });
    expect(isGuestModeReply(msg, baseChat)).toBe(true);
  });

  it("returns true when prefix used in reply to another user", () => {
    const msg = createMsg({ text: "!hello", reply_to_message: otherReply() });
    expect(isGuestModeReply(msg, baseChat)).toBe(true);
  });

  it("returns false when guest mode is disabled", () => {
    mockUseConfig.mockReturnValue({ bot_name: "mybot" });
    const msg = createMsg({ text: "hi @mybot", reply_to_message: otherReply() });
    expect(isGuestModeReply(msg, baseChat)).toBe(false);
  });

  it("returns false in private chat", () => {
    const msg = createMsg({
      chat: { id: 2, type: "private" },
      text: "hi @mybot",
      reply_to_message: otherReply(),
    });
    expect(isGuestModeReply(msg, baseChat)).toBe(false);
  });

  it("returns false without reply", () => {
    const msg = createMsg({ text: "hi @mybot" });
    expect(isGuestModeReply(msg, baseChat)).toBe(false);
  });

  it("returns false when reply is to the bot itself", () => {
    const reply = {
      ...otherReply(),
      from: { username: "mybot" },
    } as Message.TextMessage;
    const msg = createMsg({ text: "hi @mybot", reply_to_message: reply });
    expect(isGuestModeReply(msg, baseChat)).toBe(false);
  });

  it("returns false when bot not explicitly mentioned", () => {
    const msg = createMsg({ text: "just a reply", reply_to_message: otherReply() });
    expect(isGuestModeReply(msg, baseChat)).toBe(false);
  });

  it("returns false when replying to one's own message", () => {
    const reply = {
      ...otherReply(),
      from: { username: "user" },
    } as Message.TextMessage;
    const msg = createMsg({ text: "hi @mybot", reply_to_message: reply });
    expect(isGuestModeReply(msg, baseChat)).toBe(false);
  });
});
