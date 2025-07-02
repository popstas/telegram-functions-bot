import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Context, Message } from "telegraf/types";
import fs from "fs";

const mockCheckAccessLevel = jest.fn();
const mockUseConfig = jest.fn();
const mockSendTelegramMessage = jest.fn();
const mockConvertToMp3 = jest.fn();
const mockSendAudioWhisper = jest.fn();

jest.unstable_mockModule("../../src/handlers/access.ts", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockCheckAccessLevel(...args),
}));

jest.unstable_mockModule("../../src/config.ts", () => ({
  __esModule: true,
  useConfig: () => mockUseConfig(),
  syncButtons: jest.fn(),
  readConfig: jest.fn(),
  writeConfig: jest.fn(),
  generateConfig: jest.fn(),
  validateConfig: jest.fn(),
  watchConfigChanges: jest.fn(),
  generatePrivateChatConfig: jest.fn(),
  checkConfigSchema: jest.fn(),
  logConfigChanges: jest.fn(),
  setConfigPath: jest.fn(),
}));

jest.unstable_mockModule("../../src/telegram/send.ts", () => ({
  sendTelegramMessage: (...args: unknown[]) => mockSendTelegramMessage(...args),
  getFullName: jest.fn(),
  getTelegramForwardedUser: jest.fn(),
  isAdminUser: jest.fn(),
  buildButtonRows: jest.fn(),
  isOurUser: jest.fn(),
}));

jest.unstable_mockModule("../../src/helpers/stt.ts", () => ({
  convertToMp3: (...args: unknown[]) => mockConvertToMp3(...args),
  sendAudioWhisper: (...args: unknown[]) => mockSendAudioWhisper(...args),
}));

let handlers: typeof import("../../src/handlers/onAudio.ts");
let onAudio: typeof import("../../src/handlers/onAudio.ts").default;

function createCtx(message: Record<string, unknown>): Context {
  return {
    message,
    update: { message },
    telegram: {
      getFileLink: jest.fn().mockResolvedValue({ href: "http://file" }),
    },
    persistentChatAction: async (_: string, fn: () => Promise<void>) => {
      await fn();
    },
  } as unknown as Context;
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.resetModules();
  handlers = await import("../../src/handlers/onAudio.ts");
  onAudio = handlers.default;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => Buffer.from("data"),
  }) as unknown as typeof fetch;
  jest.spyOn(fs.promises, "writeFile").mockResolvedValue();
  jest.spyOn(fs, "existsSync").mockReturnValue(true);
  jest.spyOn(fs, "unlinkSync").mockImplementation(() => {});
  mockConvertToMp3.mockResolvedValue("file.mp3");
  mockSendAudioWhisper.mockResolvedValue({ text: "hello" });
});

describe("onAudio main", () => {
  it("calls processAudio when supported", async () => {
    const msg = {
      chat: { id: 1, type: "private", title: "t" },
      voice: { file_id: "v" },
    } as Message.VoiceMessage;
    mockCheckAccessLevel.mockResolvedValue({ msg });
    mockUseConfig.mockReturnValue({ stt: { whisperBaseUrl: "http://w" } });
    const ctx = createCtx(msg);
    await onAudio(ctx as Context & { secondTry?: boolean });
    expect(mockSendTelegramMessage).not.toHaveBeenCalledWith(
      1,
      expect.stringContaining("Аудио не поддерживается"),
      undefined,
      ctx,
    );
  });

  it("invokes persistentChatAction when supported", async () => {
    const msg = {
      chat: { id: 1, type: "private", title: "t" },
      voice: { file_id: "v" },
    } as Message.VoiceMessage;
    mockCheckAccessLevel.mockResolvedValue({ msg });
    mockUseConfig.mockReturnValue({ stt: { whisperBaseUrl: "http://w" } });
    const persistentChatAction = jest.fn(
      async (_: string, fn: () => Promise<void>) => {
        await fn();
      },
    );
    const ctx = {
      ...createCtx(msg),
      chat: msg.chat,
      persistentChatAction,
    } as Context & { secondTry?: boolean };
    await onAudio(ctx);
    expect(persistentChatAction).toHaveBeenCalledWith(
      "typing",
      expect.any(Function),
    );
  });
});
