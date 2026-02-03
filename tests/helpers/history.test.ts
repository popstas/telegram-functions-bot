import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Message } from "telegraf/types";
import type { ConfigChatType, ThreadStateType } from "../../src/types.ts";

const threads: Record<number, ThreadStateType> = {};

jest.unstable_mockModule("../../src/threads.ts", () => ({
  useThreads: () => threads,
}));

jest.unstable_mockModule("../../src/telegram/send.ts", () => ({
  getFullName: () => "John Doe",
  isOurUser: jest.fn(),
}));

const { addToHistory, forgetHistoryOnTimeout } = await import("../../src/helpers/history.ts");

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

  it("adds message", () => {
    const msg = createMsg("hi");
    addToHistory(msg, baseChat);
    expect(threads[1].messages[0]).toEqual({
      role: "user",
      content: "hi",
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

  it("limits history to default value", () => {
    for (let i = 0; i < 25; i += 1) {
      addToHistory(createMsg(`${i}`), baseChat);
    }
    expect(threads[1].msgs).toHaveLength(20);
    expect(threads[1].messages).toHaveLength(20);
    expect(threads[1].msgs[0].text).toBe("5");
    expect(threads[1].messages[0].content).toBe("5");
  });

  it("limits history to custom value", () => {
    const chat = { ...baseChat, chatParams: { historyLimit: 5 } };
    for (let i = 0; i < 10; i += 1) {
      addToHistory(createMsg(`${i}`), chat);
    }
    expect(threads[1].msgs).toHaveLength(5);
    expect(threads[1].messages).toHaveLength(5);
    expect(threads[1].msgs[0].text).toBe("5");
    expect(threads[1].messages[0].content).toBe("5");
  });

  it("prepends reply metadata when markReplyToMessage is true", () => {
    const replyDate = 0; // 1970-01-01 00:00:00 UTC
    const msg = {
      ...createMsg("my answer"),
      reply_to_message: {
        message_id: 2,
        date: replyDate,
        chat: { id: 1, type: "private" },
        from: { id: 2, is_bot: false, first_name: "Jane", username: "jane" },
        text: "original question",
      },
    } as Message.TextMessage;
    const chat = { ...baseChat, chatParams: { markReplyToMessage: true } };
    addToHistory(msg, chat);
    const content = threads[1].messages[0].content as string;
    expect(content).toMatch(/^\[reply to: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\+00:00, Jane\]\n/);
    expect(content).toContain("my answer");
    expect(content).toBe("[reply to: 1970-01-01 00:00:00+00:00, Jane]\nmy answer");
  });

  it("does not prepend reply metadata when markReplyToMessage is false", () => {
    const msg = {
      ...createMsg("my answer"),
      reply_to_message: {
        message_id: 2,
        date: 0,
        chat: { id: 1, type: "private" },
        from: { id: 2, is_bot: false, first_name: "Jane" },
        text: "original",
      },
    } as Message.TextMessage;
    addToHistory(msg, baseChat);
    expect(threads[1].messages[0].content).toBe("my answer");
  });
});
