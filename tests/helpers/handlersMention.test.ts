import { jest } from "@jest/globals";
import { Context, Message } from "telegraf/types";

const mockSendTelegramMessage = jest.fn();
const mockCheckAccessLevel = jest.fn();

jest.unstable_mockModule("../../src/helpers/telegram.ts", () => ({
  __esModule: true,
  sendTelegramMessage: mockSendTelegramMessage,
  getFullName: jest.fn(),
  getTelegramForwardedUser: jest.fn(),
  isAdminUser: jest.fn(),
  getCtxChatMsg: jest.fn(),
}));

jest.unstable_mockModule("../../src/handlers/access.ts", () => ({
  __esModule: true,
  default: mockCheckAccessLevel,
}));

jest.unstable_mockModule("../../src/helpers/vision.ts", () => ({
  recognizeImageText: jest.fn(),
}));

jest.unstable_mockModule("../../src/helpers/stt.ts", () => ({
  convertToMp3: jest.fn(),
  sendAudioWhisper: jest.fn(),
}));

const { default: onPhoto } = await import("../../src/handlers/onPhoto.ts");
const { default: onAudio } = await import("../../src/handlers/onAudio.ts");
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

describe("ignore unmentioned messages", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("onPhoto", async () => {
    const msg = {
      chat: { id: 1, type: "group" },
      from: { username: "u" },
      photo: [{ file_id: "1" }],
      caption: "hello",
    } as unknown as Message.PhotoMessage;
    mockCheckAccessLevel.mockResolvedValue(false);
    const ctx = createCtx(msg);
    await onPhoto(ctx);
    expect(mockSendTelegramMessage).not.toHaveBeenCalled();
  });

  it("onAudio", async () => {
    const msg = {
      chat: { id: 1, type: "group" },
      from: { username: "u" },
      voice: { file_id: "v" },
    } as unknown as Message.VoiceMessage;
    mockCheckAccessLevel.mockResolvedValue(false);
    const ctx = createCtx(msg);
    await onAudio(ctx);
    expect(mockSendTelegramMessage).not.toHaveBeenCalled();
  });

  it("onUnsupported", async () => {
    const msg = {
      chat: { id: 1, type: "group" },
      from: { username: "u" },
      document: { file_id: "d" },
    } as unknown as Message.DocumentMessage;
    mockCheckAccessLevel.mockResolvedValue(false);
    const ctx = createCtx(msg);
    await onUnsupported(ctx);
    expect(mockSendTelegramMessage).not.toHaveBeenCalled();
  });
});
