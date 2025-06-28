import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Context, Message } from "telegraf/types";

const mockCheckAccessLevel = jest.fn();
const mockUseConfig = jest.fn();
const mockSendTelegramMessage = jest.fn();

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
}));

let handlers: typeof import("../../src/handlers/onAudio.ts");
let onAudio: typeof import("../../src/handlers/onAudio.ts").default;

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
  handlers = await import("../../src/handlers/onAudio.ts");
  onAudio = handlers.default;
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
});
