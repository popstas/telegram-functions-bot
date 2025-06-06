import { jest } from "@jest/globals";
import { mockConsole } from "../testHelpers";
import { Message } from "telegraf/types";
import { ConfigChatType } from "../../src/types";

const mockGetCtxChatMsg = jest.fn();
const mockSendTelegramMessage = jest.fn();

jest.unstable_mockModule("../../src/helpers/telegram.ts", () => ({
  getCtxChatMsg: mockGetCtxChatMsg,
  isAdminUser: () => false,
  sendTelegramMessage: mockSendTelegramMessage,
}));

const { default: checkAccessLevel } = await import(
  "../../src/helpers/checkAccessLevel.ts"
);

describe("checkAccessLevel", () => {
  mockConsole();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns chat and msg when access allowed", async () => {
    const msg = {
      chat: { id: 1, type: "private" },
      from: { username: "user" },
      text: "hi",
    } as unknown as Message.TextMessage;
    const chat = {
      name: "test",
      completionParams: {},
      chatParams: {},
      toolParams: {},
    } as ConfigChatType;
    mockGetCtxChatMsg.mockReturnValue({ msg, chat });

    const ctx = { message: msg } as unknown as Parameters<
      typeof checkAccessLevel
    >[0];

    const res = await checkAccessLevel(ctx);
    expect(res).toEqual({ msg, chat });
    expect(mockSendTelegramMessage).not.toHaveBeenCalled();
  });

  it("sends message when chat is undefined", async () => {
    const msg = {
      chat: { id: 1, type: "private" },
      from: { username: "user" },
      text: "hi",
    } as unknown as Message.TextMessage;
    mockGetCtxChatMsg.mockReturnValue({ msg, chat: undefined });

    const ctx = { message: msg } as unknown as Parameters<
      typeof checkAccessLevel
    >[0];

    const res = await checkAccessLevel(ctx);
    expect(res).toBeUndefined();
    expect(mockSendTelegramMessage).toHaveBeenCalled();
  });
});
