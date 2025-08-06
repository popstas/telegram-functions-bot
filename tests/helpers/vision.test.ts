import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Context, Message } from "telegraf/types";
import type { ConfigChatType } from "../../src/types.ts";

const mockGetFileLink = jest.fn();
const mockUseBot = jest.fn(() => ({
  telegram: { getFileLink: mockGetFileLink },
}));
const mockLlCall = jest.fn();
const mockUseConfig = jest.fn();
const mockSendTelegramMessage = jest.fn();
const mockOnTextMessage = jest.fn();

jest.unstable_mockModule("../../src/bot.ts", () => ({
  useBot: (...args: unknown[]) => mockUseBot(...args),
}));

jest.unstable_mockModule("../../src/helpers/gpt.ts", () => ({
  llmCall: (...args: unknown[]) => mockLlCall(...args),
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

let vision: typeof import("../../src/helpers/vision.ts");

beforeEach(async () => {
  jest.resetModules();
  jest.clearAllMocks();
  mockUseConfig.mockReturnValue({});
  vision = await import("../../src/helpers/vision.ts");
});

function createMsg(caption?: string): Message.PhotoMessage {
  return {
    chat: { id: 1, type: "private" },
    photo: [{ file_id: "f1" }],
    caption,
  } as unknown as Message.PhotoMessage;
}

function createDocMsg(caption?: string): Message.DocumentMessage {
  return {
    chat: { id: 1, type: "private" },
    document: { file_id: "f1", mime_type: "image/png" },
    caption,
  } as unknown as Message.DocumentMessage;
}

describe("recognizeImageText", () => {
  it("throws error when model missing", async () => {
    const msg = createMsg();
    await expect(
      vision.recognizeImageText(msg, {} as ConfigChatType),
    ).rejects.toThrow("Не указана модель для распознавания.");
    expect(mockGetFileLink).toHaveBeenCalledWith("f1");
    expect(mockLlCall).not.toHaveBeenCalled();
  });

  it("calls llmCall and returns trimmed result", async () => {
    mockUseConfig.mockReturnValue({ vision: { model: "m" } });
    mockGetFileLink.mockResolvedValue("http://file");
    mockLlCall.mockResolvedValue({
      res: { choices: [{ message: { content: " ok " } }] },
    });
    const msg = createMsg("cap");
    const chat = {} as ConfigChatType;
    const res = await vision.recognizeImageText(msg, chat);
    expect(mockGetFileLink).toHaveBeenCalledWith("f1");
    expect(mockLlCall).toHaveBeenCalledWith({
      generationName: "llm-vision",
      apiParams: expect.objectContaining({
        model: "m",
      }),
      msg: msg as unknown as Message.TextMessage,
      chatConfig: chat,
      noSendTelegram: true,
    });
    expect(res).toBe("ok");
  });

  it("throws error on llmCall failure", async () => {
    mockUseConfig.mockReturnValue({ vision: { model: "m" } });
    mockGetFileLink.mockResolvedValue("http://file");
    mockLlCall.mockRejectedValue(new Error("bad"));
    const msg = createMsg();
    await expect(
      vision.recognizeImageText(msg, {} as ConfigChatType),
    ).rejects.toThrow("bad");
  });

  it("supports document messages", async () => {
    mockUseConfig.mockReturnValue({ vision: { model: "m" } });
    mockGetFileLink.mockResolvedValue("http://file");
    mockLlCall.mockResolvedValue({
      res: { choices: [{ message: { content: " ok " } }] },
    });
    const msg = createDocMsg("cap");
    const chat = {} as ConfigChatType;
    const res = await vision.recognizeImageText(msg, chat);
    expect(mockGetFileLink).toHaveBeenCalledWith("f1");
    expect(res).toBe("ok");
  });
});

describe("processImageMessage", () => {
  it("recognizes text and forwards", async () => {
    mockUseConfig.mockReturnValue({ vision: { model: "m" } });
    mockGetFileLink.mockResolvedValue("http://file");
    mockLlCall.mockResolvedValue({
      res: { choices: [{ message: { content: "ocr" } }] },
    });
    const msg = createMsg("cap");
    const chat = {} as ConfigChatType;
    const ctx = {
      message: msg,
      update: { message: msg },
      persistentChatAction: async (_: string, fn: () => Promise<void>) => {
        await fn();
      },
    } as unknown as Context;
    await vision.processImageMessage(ctx, msg, chat, "upload_photo");
    expect(mockOnTextMessage).toHaveBeenCalled();
    const calledCtx = mockOnTextMessage.mock.calls[0][0];
    expect(calledCtx.message.text).toBe("cap\n\nImage contents: ocr");
    expect(mockSendTelegramMessage).not.toHaveBeenCalled();
  });
});
