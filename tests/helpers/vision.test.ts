import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Context } from "grammy";
import type { Message } from "grammy/types";
import type { ConfigChatType } from "../../src/types.ts";

const mockGetFile = jest.fn(async () => ({ file_path: "photos/x.jpg" }));
const mockUseBot = jest.fn(() => ({
  token: "tok",
  api: { getFile: mockGetFile },
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
    await expect(vision.recognizeImageText(msg, {} as ConfigChatType)).rejects.toThrow(
      "Не указана модель для распознавания.",
    );
    expect(mockGetFile).toHaveBeenCalledWith("f1");
    expect(mockLlCall).not.toHaveBeenCalled();
  });

  it("calls llmCall and returns trimmed result", async () => {
    mockUseConfig.mockReturnValue({ vision: { model: "m" } });
    mockLlCall.mockResolvedValue({
      res: { choices: [{ message: { content: " ok " } }] },
    });
    const msg = createMsg("cap");
    const chat = {} as ConfigChatType;
    const res = await vision.recognizeImageText(msg, chat);
    expect(mockGetFile).toHaveBeenCalledWith("f1");
    expect(mockLlCall).toHaveBeenCalledWith({
      generationName: "llm-vision",
      apiParams: expect.objectContaining({
        model: "m",
        messages: [
          expect.objectContaining({
            content: expect.arrayContaining([
              {
                type: "image_url",
                image_url: { url: "https://api.telegram.org/file/bottok/photos/x.jpg" },
              },
            ]),
          }),
        ],
      }),
      msg: msg as unknown as Message.TextMessage,
      chatConfig: chat,
      noSendTelegram: true,
    });
    expect(res).toBe("ok");
  });

  it("throws error on llmCall failure", async () => {
    mockUseConfig.mockReturnValue({ vision: { model: "m" } });
    mockLlCall.mockRejectedValue(new Error("bad"));
    const msg = createMsg();
    await expect(vision.recognizeImageText(msg, {} as ConfigChatType)).rejects.toThrow("bad");
  });

  it("supports document messages", async () => {
    mockUseConfig.mockReturnValue({ vision: { model: "m" } });
    mockLlCall.mockResolvedValue({
      res: { choices: [{ message: { content: " ok " } }] },
    });
    const msg = createDocMsg("cap");
    const chat = {} as ConfigChatType;
    const res = await vision.recognizeImageText(msg, chat);
    expect(mockGetFile).toHaveBeenCalledWith("f1");
    expect(res).toBe("ok");
  });
});

describe("processImageMessage", () => {
  it("recognizes text and forwards", async () => {
    mockUseConfig.mockReturnValue({ vision: { model: "m" } });
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
