import { jest, describe, it, expect, beforeEach, beforeAll } from "@jest/globals";
import type { Context } from "grammy";

const mockConvertToMp3 = jest.fn();
const mockSendAudioWhisper = jest.fn();
const mockSendTelegramMessage = jest.fn();
const mockOnTextMessage = jest.fn();

jest.unstable_mockModule("../../src/helpers/stt.ts", () => ({
  convertToMp3: (...args: unknown[]) => mockConvertToMp3(...args),
  sendAudioWhisper: (...args: unknown[]) => mockSendAudioWhisper(...args),
}));

jest.unstable_mockModule("../../src/telegram/send.ts", () => ({
  sendTelegramMessage: (...args: unknown[]) => mockSendTelegramMessage(...args),
  sendTelegramDocument: jest.fn(),
  editTelegramMessage: jest.fn(),
  getFullName: jest.fn(),
  getTelegramForwardedUser: jest.fn(),
  isAdminUser: jest.fn(),
  buildButtonRows: jest.fn(),
}));

jest.unstable_mockModule("../../src/handlers/onTextMessage.ts", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockOnTextMessage(...args),
}));

import fs from "fs";

let transcribe: typeof import("../../src/handlers/onAudio.ts").transcribe;

beforeAll(async () => {
  transcribe = (await import("../../src/handlers/onAudio.ts")).transcribe;
});

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => Buffer.from("data"),
  }) as unknown as typeof fetch;
  jest.spyOn(fs.promises, "writeFile").mockResolvedValue();
  jest.spyOn(fs, "existsSync").mockReturnValue(true);
  jest.spyOn(fs, "unlinkSync").mockImplementation(() => {});
  mockConvertToMp3.mockResolvedValue("file.mp3");
});

function createCtx(): Context {
  return {
    api: {
      getFile: jest.fn(async () => ({ file_path: "voice/f.oga" })),
      token: "tok",
    },
  } as unknown as Context;
}

describe("transcribe", () => {
  it("возвращает распознанный текст и ничего не отправляет", async () => {
    mockSendAudioWhisper.mockResolvedValue({ text: "как отвечать на дорого" });
    const text = await transcribe(createCtx(), { file_id: "v1" });
    expect(text).toBe("как отвечать на дорого");
    expect(mockSendTelegramMessage).not.toHaveBeenCalled();
    expect(mockOnTextMessage).not.toHaveBeenCalled();
  });

  it("склеивает segments, когда text пустой", async () => {
    mockSendAudioWhisper.mockResolvedValue({
      segments: [{ text: "первый" }, { text: " второй" }],
    });
    expect(await transcribe(createCtx(), { file_id: "v1" })).toBe("первый  второй");
  });

  it("возвращает пустую строку при ошибке whisper и ничего не отправляет", async () => {
    mockSendAudioWhisper.mockResolvedValue({ error: "boom" });
    expect(await transcribe(createCtx(), { file_id: "v1" })).toBe("");
    expect(mockSendTelegramMessage).not.toHaveBeenCalled();
  });

  it("возвращает пустую строку, когда whisper падает исключением", async () => {
    mockSendAudioWhisper.mockRejectedValue(new Error("network"));
    expect(await transcribe(createCtx(), { file_id: "v1" })).toBe("");
    expect(mockSendTelegramMessage).not.toHaveBeenCalled();
  });

  it("убирает временные файлы после себя", async () => {
    mockSendAudioWhisper.mockResolvedValue({ text: "ок" });
    await transcribe(createCtx(), { file_id: "v1" });
    expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
  });
});
