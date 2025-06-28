import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Context, Message } from "telegraf/types";
import type { ConfigChatType } from "../../src/types";

const threads: Record<
  number,
  {
    id: number;
    msgs: Message[];
    messages: Message[];
    completionParams: Record<string, unknown>;
  }
> = {
  1: { id: 1, msgs: [], messages: [], completionParams: {} },
};

const mockCheckAccessLevel = jest.fn();
const mockAddToHistory = jest.fn();
const mockResolveChatButtons = jest.fn();
const mockRequestGptAnswer = jest.fn();
const mockSendTelegramMessage = jest.fn();
const mockUseConfig = jest.fn();

jest.unstable_mockModule("../../src/handlers/access.ts", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockCheckAccessLevel(...args),
}));

jest.unstable_mockModule("../../src/helpers/history.ts", () => ({
  addToHistory: (...args: unknown[]) => mockAddToHistory(...args),
  forgetHistoryOnTimeout: jest.fn(),
  forgetHistory: jest.fn(),
}));

jest.unstable_mockModule("../../src/handlers/resolveChatButtons.ts", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockResolveChatButtons(...args),
}));

jest.unstable_mockModule("../../src/helpers/gpt.ts", () => ({
  requestGptAnswer: (...args: unknown[]) => mockRequestGptAnswer(...args),
}));

jest.unstable_mockModule("../../src/telegram/send.ts", () => ({
  sendTelegramMessage: (...args: unknown[]) => mockSendTelegramMessage(...args),
  getFullName: jest.fn(),
  getTelegramForwardedUser: jest.fn(),
  isAdminUser: jest.fn(),
  buildButtonRows: jest.fn(),
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

jest.unstable_mockModule("../../src/threads.ts", () => ({
  useThreads: () => threads,
}));

let handlers: typeof import("../../src/handlers/onTextMessage.ts");
let onTextMessage: typeof import("../../src/handlers/onTextMessage.ts").default;

function createCtx(
  message: Record<string, unknown>,
): Context & { secondTry?: boolean } {
  return {
    message,
    update: { message },
    persistentChatAction: async (_: string, fn: () => Promise<void>) => {
      await fn();
    },
  } as unknown as Context & { secondTry?: boolean };
}

const baseChat: ConfigChatType = {
  name: "chat",
  completionParams: {},
  chatParams: {},
  toolParams: {},
} as ConfigChatType;

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.resetModules();
  handlers = await import("../../src/handlers/onTextMessage.ts");
  onTextMessage = handlers.default;
  mockUseConfig.mockReturnValue({ auth: {} });
  mockRequestGptAnswer.mockResolvedValue({ content: "ok" });
  mockSendTelegramMessage.mockResolvedValue({
    chat: { id: 1 },
  } as unknown as Message.TextMessage);
  threads[1] = { id: 1, msgs: [], messages: [], completionParams: {} };
});

afterEach(() => {
  jest.useRealTimers();
});

describe("onTextMessage cancel", () => {
  it("cancels previous response when new message arrives", async () => {
    const msg1 = {
      chat: { id: 1, type: "private" },
      from: { id: 1 },
      text: "a",
    } as Message.TextMessage;
    const msg2 = {
      chat: { id: 1, type: "private" },
      from: { id: 1 },
      text: "b",
    } as Message.TextMessage;
    const chat = baseChat;
    mockCheckAccessLevel.mockResolvedValueOnce({ msg: msg1, chat });
    mockCheckAccessLevel.mockResolvedValueOnce({ msg: msg2, chat });

    const cb1 = jest.fn();
    const cb2 = jest.fn();
    await onTextMessage(createCtx(msg1), undefined, cb1);
    jest.advanceTimersByTime(100);
    await onTextMessage(createCtx(msg2), undefined, cb2);
    await jest.runAllTimersAsync();
    await Promise.resolve();

    expect(cb1).not.toHaveBeenCalled();
  });
});
