import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Message } from "telegraf/types";
import type { ConfigChatType, ThreadStateType } from "../../src/types";

const threads: Record<number, ThreadStateType> = {};

jest.unstable_mockModule("../../src/threads.ts", () => ({
  useThreads: () => threads,
}));

jest.unstable_mockModule("../../src/telegram/send.ts", () => ({
  getFullName: () => "John Doe",
  isOurUser: jest.fn(),
}));

const { addToHistory, forgetHistoryOnTimeout } = await import(
  "../../src/helpers/history.ts"
);

describe("history helpers", () => {
  beforeEach(() => {
    for (const k of Object.keys(threads)) delete threads[Number(k)];
  });

  function createMsg(text: string, date = 0): Message.TextMessage {
    return {
      chat: { id: 1, type: "private" },
      from: { id: 1, is_bot: false, first_name: "John" },
      message_id: 1,
      date,
      text,
    } as Message.TextMessage;
  }

  const baseChat: ConfigChatType = {
    name: "chat",
    completionParams: {},
    chatParams: {},
    toolParams: {},
  } as ConfigChatType;

  it("adds message with username", () => {
    const msg = createMsg("hi");
    addToHistory({ msg, showTelegramNames: true });
    expect(threads[1].messages[0]).toEqual({
      role: "user",
      content: "John Doe:\nhi",
      name: "John",
    });
    expect(threads[1].msgs[0]).toBe(msg);
  });

  it("handles timeout and forgets history", () => {
    const oldMsg = createMsg("1", 0);
    const recentMsg = createMsg("2", 10);
    threads[1] = {
      id: 1,
      msgs: [oldMsg, recentMsg],
      messages: [{ role: "user", content: "1" }],
    } as ThreadStateType;
    jest.spyOn(Date, "now").mockReturnValue((oldMsg.date + 11) * 1000);
    const chat = { ...baseChat, chatParams: { forgetTimeout: 10 } };
    const res = forgetHistoryOnTimeout(chat, recentMsg);
    expect(res).toBe(true);
    expect(threads[1].messages.length).toBe(1);
    expect(threads[1].messages[0].content).toBe("2");
  });
});
