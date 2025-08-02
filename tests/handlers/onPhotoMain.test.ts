import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Context, Message } from "telegraf/types";
import type { ConfigChatType } from "../../src/types";

const mockCheckAccessLevel = jest.fn();
const mockRecognizeImageText = jest.fn();
const mockUseConfig = jest.fn();
const mockSendTelegramMessage = jest.fn();
const mockOnTextMessage = jest.fn();

jest.unstable_mockModule("../../src/handlers/access.ts", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockCheckAccessLevel(...args),
}));

jest.unstable_mockModule("../../src/helpers/vision.ts", () => ({
  recognizeImageText: (...args: unknown[]) => mockRecognizeImageText(...args),
}));

jest.unstable_mockModule("../../src/config.ts", () => ({
  useConfig: () => mockUseConfig(),
  updateChatInConfig: jest.fn(),
}));

jest.unstable_mockModule("../../src/telegram/send.ts", () => ({
  sendTelegramMessage: (...args: unknown[]) => mockSendTelegramMessage(...args),
  sendTelegramDocument: jest.fn(),
}));

jest.unstable_mockModule("../../src/handlers/onTextMessage.ts", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockOnTextMessage(...args),
}));

let onPhoto: typeof import("../../src/handlers/onPhoto.ts").default;

function createCtx(message: Record<string, unknown>): Context {
  return {
    message,
    update: { message },
    persistentChatAction: async (_: string, fn: () => Promise<void>) => {
      await fn();
    },
  } as unknown as Context;
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.resetModules();
  onPhoto = (await import("../../src/handlers/onPhoto.ts")).default;
});

describe("onPhoto main flow", () => {
  it("recognizes text and forwards", async () => {
    const msg = {
      chat: { id: 1, type: "private", title: "t" },
      photo: [{ file_id: "f" }],
      caption: "cap",
    } as Message.PhotoMessage;
    const chat: ConfigChatType = {
      name: "c",
      completionParams: {},
      chatParams: {},
      toolParams: {},
    } as ConfigChatType;
    mockCheckAccessLevel.mockResolvedValue({ msg, chat });
    mockUseConfig.mockReturnValue({ vision: { model: "m" } });
    mockRecognizeImageText.mockResolvedValue("ocr");
    const ctx = createCtx(msg);
    await onPhoto(ctx);
    expect(mockRecognizeImageText).toHaveBeenCalledWith(msg, chat);
    expect(mockOnTextMessage).toHaveBeenCalled();
    const calledCtx = mockOnTextMessage.mock.calls[0][0];
    expect(calledCtx.message.text).toBe("cap\n\nImage contents: ocr");
    expect(mockSendTelegramMessage).not.toHaveBeenCalled();
  });

  it("skips ocr when caption is long", async () => {
    const caption = "a".repeat(101);
    const msg = {
      chat: { id: 1, type: "private", title: "t" },
      photo: [{ file_id: "f" }],
      caption,
    } as Message.PhotoMessage;
    mockCheckAccessLevel.mockResolvedValue({ msg, chat: {} as ConfigChatType });
    mockUseConfig.mockReturnValue({ vision: { model: "m" } });
    const ctx = createCtx(msg);
    await onPhoto(ctx);
    expect(mockRecognizeImageText).not.toHaveBeenCalled();
    expect(mockOnTextMessage).toHaveBeenCalled();
    const calledCtx = mockOnTextMessage.mock.calls[0][0];
    expect(calledCtx.message.text).toBe(caption);
  });
});
