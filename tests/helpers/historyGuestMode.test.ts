import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Message } from "telegraf/types";
import type { ConfigChatType, ThreadStateType } from "../../src/types.ts";

const threads: Record<number, ThreadStateType> = {};
const mockUseConfig = jest.fn();

jest.unstable_mockModule("../../src/threads.ts", () => ({
  useThreads: () => threads,
}));

jest.unstable_mockModule("../../src/telegram/send.ts", () => ({
  getFullName: () => "John Doe",
  isOurUser: jest.fn(),
  isAdminUser: jest.fn(),
  sendTelegramMessage: jest.fn(),
  sendTelegramDocument: jest.fn(),
}));

jest.unstable_mockModule("../../src/config.ts", () => ({
  useConfig: () => mockUseConfig(),
  updateChatInConfig: jest.fn(),
}));

const { addToHistory } = await import("../../src/helpers/history.ts");

const baseChat: ConfigChatType = {
  name: "chat",
  prefix: "!",
  completionParams: {},
  chatParams: {},
  toolParams: {},
} as ConfigChatType;

function guestMsg(): Message.TextMessage {
  return {
    chat: { id: 1, type: "group" },
    from: { id: 1, is_bot: false, username: "user", first_name: "User" },
    message_id: 5,
    date: 0,
    text: "@mybot what do you think?",
    reply_to_message: {
      chat: { id: 1, type: "group" },
      from: { id: 2, is_bot: false, username: "other", first_name: "Other" },
      message_id: 4,
      date: 0,
      text: "original question",
    },
  } as Message.TextMessage;
}

beforeEach(() => {
  for (const k of Object.keys(threads)) delete threads[Number(k)];
  jest.clearAllMocks();
});

describe("addToHistory guest mode", () => {
  it("includes the replied-to message when guest mode applies", () => {
    mockUseConfig.mockReturnValue({ bot_name: "mybot", guestMode: { prompt: "guest" } });
    addToHistory(guestMsg(), baseChat);
    expect(threads[1].messages).toHaveLength(2);
    expect(threads[1].messages[0]).toEqual({
      role: "user",
      content: "original question",
      name: "Other",
    });
    expect(threads[1].messages[1].content).toBe("@mybot what do you think?");
  });

  it("does not include the replied-to message when guest mode is disabled", () => {
    mockUseConfig.mockReturnValue({ bot_name: "mybot" });
    addToHistory(guestMsg(), baseChat);
    expect(threads[1].messages).toHaveLength(1);
    expect(threads[1].messages[0].content).toBe("@mybot what do you think?");
  });
});
