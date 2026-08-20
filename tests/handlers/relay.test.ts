import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Message } from "grammy/types";
import type { ConfigChatType } from "../../src/types.ts";
import type { BotContext } from "../../src/telegram/botContext.ts";

const mockGetCtxChatMsg = jest.fn();
const mockSendTelegramMessage = jest.fn();
const mockResolveRecipientChatId = jest.fn();

jest.unstable_mockModule("../../src/telegram/context.ts", () => ({
  getCtxChatMsg: mockGetCtxChatMsg,
  getActionUserMsg: jest.fn(),
  createNewContext: jest.fn(),
}));

jest.unstable_mockModule("../../src/telegram/send.ts", () => ({
  sendTelegramMessage: mockSendTelegramMessage,
  sendTelegramDocument: jest.fn(),
  editTelegramMessage: jest.fn(),
  isAdminUser: jest.fn(),
  getFullName: (msg: { from?: { first_name?: string; last_name?: string } }) =>
    [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ").trim(),
}));

jest.unstable_mockModule("../../src/helpers/recipients.ts", () => ({
  resolveRecipientChatId: mockResolveRecipientChatId,
}));

jest.unstable_mockModule("../../src/helpers.ts", () => ({
  log: jest.fn(),
}));

const {
  default: relayMiddleware,
  relayMessage,
  renderHeader,
  detectMessageType,
  __testRelay,
} = await import("../../src/handlers/relay.ts");

const NOW = new Date(2026, 7, 20, 18, 5); // 2026-08-20 18:05, local time

function createCtx(message: Record<string, unknown>) {
  return {
    message,
    update: { message },
    chat: message.chat,
    api: {
      sendMessage: jest.fn(),
      copyMessage: jest.fn(),
    },
  } as unknown as BotContext & { api: { sendMessage: jest.Mock; copyMessage: jest.Mock } };
}

function voiceMsg(extra: Record<string, unknown> = {}) {
  return {
    message_id: 42,
    chat: { id: 111, type: "private" },
    from: { id: 7, username: "manager", first_name: "Пётр", last_name: "Иванов" },
    voice: { file_id: "v1" },
    ...extra,
  } as unknown as Message.TextMessage;
}

function setChat(chat: Partial<ConfigChatType> | undefined, msg: unknown) {
  mockGetCtxChatMsg.mockReturnValue({ chat, msg });
}

describe("relay", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __testRelay.reset();
    mockResolveRecipientChatId.mockImplementation((r: unknown) =>
      typeof r === "number" ? r : undefined,
    );
  });

  describe("detectMessageType", () => {
    it("names the type carried by the message", () => {
      expect(detectMessageType({ voice: {} } as unknown as Message)).toBe("voice");
      expect(detectMessageType({ text: "hi" } as unknown as Message)).toBe("text");
      expect(detectMessageType({ document: {} } as unknown as Message)).toBe("document");
    });

    it("falls back to other for types it does not name", () => {
      expect(detectMessageType({ dice: {} } as unknown as Message)).toBe("other");
    });
  });

  describe("renderHeader", () => {
    it("fills name, username and timestamp", () => {
      const header = renderHeader("{name} (@{username}), {date} {time}", voiceMsg(), NOW);
      expect(header).toBe("Пётр Иванов (@manager), 2026-08-20 18:05");
    });

    it("drops the empty parens when the author has no username", () => {
      const msg = voiceMsg({ from: { id: 7, first_name: "Пётр" } });
      expect(renderHeader("{name} (@{username})", msg, NOW)).toBe("Пётр");
    });
  });

  describe("relayMessage", () => {
    it("copies the message to every target and confirms to the author", async () => {
      const msg = voiceMsg();
      setChat({ chatParams: { relay: { send_to: [-100, -200], reply: "Принял" } } }, msg);
      const ctx = createCtx(msg as unknown as Record<string, unknown>);

      const handled = await relayMessage(ctx, NOW);

      expect(handled).toBe(true);
      expect(ctx.api.copyMessage).toHaveBeenCalledTimes(2);
      expect(ctx.api.copyMessage).toHaveBeenCalledWith(-100, 111, 42);
      expect(ctx.api.copyMessage).toHaveBeenCalledWith(-200, 111, 42);
      expect(ctx.api.sendMessage).toHaveBeenCalledWith(
        -100,
        "Пётр Иванов (@manager), 2026-08-20 18:05",
      );
      expect(mockSendTelegramMessage).toHaveBeenCalledWith(111, "Принял", undefined, ctx);
    });

    it("relays non-audio types too", async () => {
      const msg = voiceMsg({ voice: undefined, document: { file_id: "d1" } });
      setChat({ chatParams: { relay: { send_to: [-100] } } }, msg);
      const ctx = createCtx(msg as unknown as Record<string, unknown>);

      expect(await relayMessage(ctx, NOW)).toBe(true);
      expect(ctx.api.copyMessage).toHaveBeenCalledWith(-100, 111, 42);
    });

    it("stays silent when the chat has no relay config", async () => {
      const msg = voiceMsg();
      setChat({ chatParams: {} }, msg);
      const ctx = createCtx(msg as unknown as Record<string, unknown>);

      expect(await relayMessage(ctx, NOW)).toBe(false);
      expect(ctx.api.copyMessage).not.toHaveBeenCalled();
      expect(mockSendTelegramMessage).not.toHaveBeenCalled();
    });

    it("skips message types outside the configured list", async () => {
      const msg = voiceMsg({ voice: undefined, text: "hi" });
      setChat({ chatParams: { relay: { send_to: [-100], types: ["voice"] } } }, msg);
      const ctx = createCtx(msg as unknown as Record<string, unknown>);

      expect(await relayMessage(ctx, NOW)).toBe(false);
      expect(ctx.api.copyMessage).not.toHaveBeenCalled();
    });

    it("sends the header once per album, but copies every part", async () => {
      setChat({ chatParams: { relay: { send_to: [-100] } } }, undefined);
      for (const messageId of [1, 2, 3]) {
        const msg = voiceMsg({
          message_id: messageId,
          voice: undefined,
          photo: [{ file_id: `p${messageId}` }],
          media_group_id: "album-1",
        });
        setChat({ chatParams: { relay: { send_to: [-100] } } }, msg);
        const ctx = createCtx(msg as unknown as Record<string, unknown>);
        await relayMessage(ctx, NOW);
        expect(ctx.api.copyMessage).toHaveBeenCalledWith(-100, 111, messageId);
        expect(ctx.api.sendMessage).toHaveBeenCalledTimes(messageId === 1 ? 1 : 0);
      }
    });

    it("never copies a chat into itself", async () => {
      // Config matched by the target group itself: relaying would re-relay the copy.
      const msg = voiceMsg({ chat: { id: -100, type: "supergroup" } });
      setChat({ chatParams: { relay: { send_to: [-100], reply: "Принял" } } }, msg);
      const ctx = createCtx(msg as unknown as Record<string, unknown>);

      expect(await relayMessage(ctx, NOW)).toBe(false);
      expect(ctx.api.copyMessage).not.toHaveBeenCalled();
      expect(mockSendTelegramMessage).not.toHaveBeenCalled();
    });

    it("still relays to the other targets when one of them is the source", async () => {
      const msg = voiceMsg({ chat: { id: -100, type: "supergroup" } });
      setChat({ chatParams: { relay: { send_to: [-100, -200] } } }, msg);
      const ctx = createCtx(msg as unknown as Record<string, unknown>);

      expect(await relayMessage(ctx, NOW)).toBe(true);
      expect(ctx.api.copyMessage).toHaveBeenCalledTimes(1);
      expect(ctx.api.copyMessage).toHaveBeenCalledWith(-200, -100, 42);
    });

    it("warns the author when no target could be resolved", async () => {
      const msg = voiceMsg();
      setChat({ chatParams: { relay: { send_to: ["missing-chat"], reply: "Принял" } } }, msg);
      const ctx = createCtx(msg as unknown as Record<string, unknown>);

      expect(await relayMessage(ctx, NOW)).toBe(true);
      expect(ctx.api.copyMessage).not.toHaveBeenCalled();
      expect(mockSendTelegramMessage).toHaveBeenCalledWith(
        111,
        "Не удалось переслать сообщение",
        undefined,
        ctx,
      );
    });

    it("reports failure to the author when every target throws", async () => {
      const msg = voiceMsg();
      setChat({ chatParams: { relay: { send_to: [-100], reply: "Принял" } } }, msg);
      const ctx = createCtx(msg as unknown as Record<string, unknown>);
      ctx.api.copyMessage.mockRejectedValue(new Error("chat not found") as never);

      expect(await relayMessage(ctx, NOW)).toBe(true);
      expect(mockSendTelegramMessage).toHaveBeenCalledWith(
        111,
        "Не удалось переслать сообщение",
        undefined,
        ctx,
      );
    });

    it("does nothing when the sender resolved to no chat config", async () => {
      const msg = voiceMsg();
      setChat(undefined, msg);
      const ctx = createCtx(msg as unknown as Record<string, unknown>);

      expect(await relayMessage(ctx, NOW)).toBe(false);
      expect(ctx.api.copyMessage).not.toHaveBeenCalled();
    });
  });

  describe("relayMiddleware", () => {
    it("stops the chain for relay chats", async () => {
      const msg = voiceMsg();
      setChat({ chatParams: { relay: { send_to: [-100] } } }, msg);
      const ctx = createCtx(msg as unknown as Record<string, unknown>);
      const next = jest.fn(async () => {});

      await relayMiddleware(ctx, next);
      expect(next).not.toHaveBeenCalled();
    });

    it("passes non-relay chats through to the normal handlers", async () => {
      const msg = voiceMsg();
      setChat({ chatParams: {} }, msg);
      const ctx = createCtx(msg as unknown as Record<string, unknown>);
      const next = jest.fn(async () => {});

      await relayMiddleware(ctx, next);
      expect(next).toHaveBeenCalled();
    });
  });
});
