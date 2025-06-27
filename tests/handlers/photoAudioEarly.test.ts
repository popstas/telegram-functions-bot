import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Context, Message } from "telegraf/types";

const mockCheckAccessLevel = jest.fn();
const mockSendTelegramMessage = jest.fn();
const mockUseConfig = jest.fn();

jest.unstable_mockModule("../../src/telegram/send.ts", () => ({
  sendTelegramMessage: mockSendTelegramMessage,
  getFullName: jest.fn(),
  getTelegramForwardedUser: jest.fn(),
  isAdminUser: jest.fn(),
  buildButtonRows: jest.fn(),
}));

jest.unstable_mockModule("../../src/handlers/access.ts", () => ({
  __esModule: true,
  default: mockCheckAccessLevel,
}));

jest.unstable_mockModule("../../src/config.ts", () => ({
  useConfig: () => mockUseConfig(),
  readConfig: jest.fn(),
  syncButtons: jest.fn(),
}));

const { default: onPhoto } = await import("../../src/handlers/onPhoto.ts");
const { default: onAudio } = await import("../../src/handlers/onAudio.ts");

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

describe("onPhoto/onAudio early branches", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("photo unsupported", async () => {
    const msg = {
      chat: { id: 1, type: "group" },
      from: { username: "u" },
      photo: [{ file_id: "1" }],
    } as unknown as Message.PhotoMessage;
    mockCheckAccessLevel.mockResolvedValue({ msg, chat: {} });
    mockUseConfig.mockReturnValue({});
    const ctx = createCtx(msg);
    await onPhoto(ctx);
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      1,
      expect.stringContaining("обработка изображений"),
    );
  });

  it("audio unsupported", async () => {
    const msg = {
      chat: { id: 1, type: "group" },
      from: { username: "u" },
      voice: { file_id: "v" },
    } as unknown as Message.VoiceMessage;
    mockCheckAccessLevel.mockResolvedValue({ msg });
    mockUseConfig.mockReturnValue({});
    const ctx = createCtx(msg);
    await onAudio(ctx);
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      1,
      expect.stringContaining("Аудио не поддерживается"),
      undefined,
      ctx,
    );
  });
});
