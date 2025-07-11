import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Context, Message } from "telegraf/types";

const mockCheckAccessLevel = jest.fn();
const mockSendTelegramMessage = jest.fn();

jest.unstable_mockModule("../../src/handlers/access.ts", () => ({
  __esModule: true,
  default: mockCheckAccessLevel,
}));

jest.unstable_mockModule("../../src/telegram/send.ts", () => ({
  sendTelegramMessage: mockSendTelegramMessage,
  sendTelegramDocument: jest.fn(),
}));

const { default: onUnsupported } = await import(
  "../../src/handlers/onUnsupported.ts"
);

function createCtx(message: Record<string, unknown>): Context {
  return {
    message,
    update: { message },
    chat: message.chat,
    persistentChatAction: async (_: string, fn: () => Promise<void>) => {
      await fn();
    },
  } as unknown as Context;
}

describe("onUnsupported", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("handles known type", async () => {
    const msg = {
      chat: { id: 1, type: "group" },
      from: { username: "u" },
      video: { file_id: "v" },
    } as unknown as Message.VideoMessage;
    mockCheckAccessLevel.mockResolvedValue({ msg });
    const ctx = createCtx(msg);
    await onUnsupported(ctx);
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      1,
      expect.stringContaining("видео"),
      {},
      ctx,
    );
  });

  it("handles unknown type", async () => {
    const msg = {
      chat: { id: 1, type: "group" },
      from: { username: "u" },
    } as unknown as Message.TextMessage;
    mockCheckAccessLevel.mockResolvedValue({ msg });
    const ctx = createCtx(msg);
    await onUnsupported(ctx);
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      1,
      expect.stringContaining("неизвестного"),
      {},
      ctx,
    );
  });
});
