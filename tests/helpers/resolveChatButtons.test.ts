import { jest } from "@jest/globals";
import { Context, Message } from "telegraf/types";
import { ConfigChatType, ConfigChatButtonType, ThreadStateType } from "../../src/types.ts";

const mockSendTelegramMessage = jest.fn();

jest.unstable_mockModule("../../src/telegram/send.ts", () => ({
  sendTelegramMessage: mockSendTelegramMessage,
  sendTelegramDocument: jest.fn(),
}));

const { default: resolveChatButtons } = await import("../../src/handlers/resolveChatButtons.ts");

describe("resolveChatButtons", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createMsg(text: string): Message.TextMessage {
    return {
      chat: { id: 1, type: "private" },
      from: { id: 1, is_bot: false, first_name: "U" },
      message_id: 1,
      date: 0,
      text,
    } as Message.TextMessage;
  }

  const baseChat: ConfigChatType = {
    name: "chat",
    completionParams: {},
    chatParams: {},
    toolParams: {},
  } as ConfigChatType;

  it("activates button with waitMessage", async () => {
    const button: ConfigChatButtonType = {
      name: "b",
      prompt: "p",
      waitMessage: "w",
    };
    const chat = { ...baseChat, buttons: [button] };
    const msg = createMsg("b");
    const thread: ThreadStateType = {
      id: 1,
      msgs: [],
      messages: [],
      completionParams: {},
      dynamicButtons: undefined,
    };

    const res = await resolveChatButtons({} as unknown as Context, msg, chat, thread, {});

    expect(res).toBeUndefined();
    expect(thread.activeButton).toEqual(button);
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(1, "w", {}, {}, chat);
  });

  it("replaces text when button without waitMessage", async () => {
    const button: ConfigChatButtonType = { name: "b", prompt: "p" };
    const chat = { ...baseChat, buttons: [button] };
    const msg = createMsg("b");
    const thread: ThreadStateType = {
      id: 1,
      msgs: [],
      messages: [],
      completionParams: {},
      dynamicButtons: undefined,
    };

    await resolveChatButtons({} as unknown as Context, msg, chat, thread, {});
    expect(msg.text).toBe("p");
    expect(mockSendTelegramMessage).not.toHaveBeenCalled();
  });

  it("handles activeButton", async () => {
    const msg = createMsg("hello");
    const chat = { ...baseChat };
    const thread: ThreadStateType = {
      id: 1,
      msgs: [],
      messages: [{ role: "user", content: "" }],
      completionParams: {},
      activeButton: { name: "b", prompt: "p" },
      dynamicButtons: undefined,
    } as ThreadStateType;

    await resolveChatButtons({} as unknown as Context, msg, chat, thread, {});
    expect(thread.activeButton).toBeUndefined();
    expect(thread.nextSystemMessage).toBe("p");
  });

  it("matches dynamic buttons before config buttons", async () => {
    const dynButton: ConfigChatButtonType = { name: "d", prompt: "pd" };
    const chat = { ...baseChat, buttons: [{ name: "d", prompt: "pc" }] };
    const msg = createMsg("d");
    const thread: ThreadStateType = {
      id: 1,
      msgs: [],
      messages: [],
      completionParams: {},
      dynamicButtons: [dynButton],
    };
    await resolveChatButtons({} as unknown as Context, msg, chat, thread, {});
    expect(msg.text).toBe("pd");
    expect(thread.dynamicButtons).toBeUndefined();
  });
});
