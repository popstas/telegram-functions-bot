import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Context, Message } from "telegraf/types";

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

let processAudio: typeof import("../../src/handlers/onAudio.ts").processAudio;

beforeAll(async () => {
  processAudio = (await import("../../src/handlers/onAudio.ts")).processAudio;
});

function createCtx(): Context {
  return {
    telegram: {
      getFileLink: jest.fn().mockResolvedValue({ href: "http://file" }),
    },
    persistentChatAction: async (_: string, fn: () => Promise<void>) => {
      await fn();
    },
    message: {} as Message,
    update: { message: {} } as unknown as { message: Message },
  } as unknown as Context;
}

beforeEach(async () => {
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

describe("processAudio", () => {
  it("processes text and forwards", async () => {
    mockSendAudioWhisper.mockResolvedValue({ text: "hello" });
    const ctx = createCtx();
    await processAudio(ctx as Context, { file_id: "f" }, 1);
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      1,
      "hello.",
      undefined,
      ctx,
    );
    expect(mockOnTextMessage).toHaveBeenCalled();
  });

  it("handles whisper error", async () => {
    mockSendAudioWhisper.mockResolvedValue({ error: "bad" });
    const ctx = createCtx();
    await processAudio(ctx as Context, { file_id: "f" }, 1);
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      1,
      expect.stringContaining("Ошибка распознавания: bad"),
      undefined,
      ctx,
    );
    expect(mockOnTextMessage).not.toHaveBeenCalled();
  });

  it("handles fetch error", async () => {
    (global.fetch as unknown as jest.Mock).mockRejectedValue(new Error("fail"));
    const ctx = createCtx();
    await processAudio(ctx as Context, { file_id: "f" }, 1);
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      1,
      expect.stringContaining("Произошла ошибка"),
      undefined,
      ctx,
    );
  });
});
