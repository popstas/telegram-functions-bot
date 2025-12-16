import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import type { Context, Message } from "telegraf/types";
import type { ConfigChatType } from "../../src/types.ts";

// Extend the global namespace
declare global {
  // These are type declarations for the global variables
  interface Global {
    firstAbortController: AbortController | undefined;
    secondAbortController: AbortController | undefined;
  }
}

// Initialize global variables
if (global.firstAbortController === undefined) {
  global.firstAbortController = undefined;
}
if (global.secondAbortController === undefined) {
  global.secondAbortController = undefined;
}

interface Thread {
  id: number;
  msgs: Message[];
  messages: Message[];
  completionParams: Record<string, unknown>;
}

const threads: Record<number, Thread> = {
  1: { id: 1, msgs: [], messages: [], completionParams: {} },
};

// Mock functions with proper types
const mockCheckAccessLevel = jest.fn<
  Promise<{ msg: Message.TextMessage; chat: ConfigChatType } | false | undefined>,
  [Context]
>();
const mockAddToHistory = jest.fn<Message.TextMessage, [Message.TextMessage]>();
const mockResolveChatButtons = jest.fn<Message.TextMessage, [Message.TextMessage]>();
const mockGenerateButtonsFromAgent = jest.fn();
// Mock function for requestGptAnswer with proper typing
const mockRequestGptAnswer = jest.fn(
  (_msg: Message.TextMessage, _chat: ConfigChatType, options?: { signal?: AbortSignal }) => {
    // Store the abort controller for testing
    const signal = options?.signal as unknown as {
      controller?: AbortController;
    };
    if (signal?.controller) {
      if (!global.firstAbortController) {
        global.firstAbortController = signal.controller;
      } else {
        global.secondAbortController = signal.controller;
      }
    }
    return Promise.resolve({ content: "test response" });
  },
) as jest.MockedFunction<
  (
    msg: Message.TextMessage,
    chat: ConfigChatType,
    options?: { signal?: AbortSignal },
  ) => Promise<{ content: string }>
>;

// Mock function for sendTelegramMessage
const mockSendTelegramMessage = jest.fn(() =>
  Promise.resolve({
    message_id: 100,
    date: Math.floor(Date.now() / 1000),
    chat: { id: 1, type: "private", first_name: "Test" },
    text: "test response",
  } as Message.TextMessage),
);

const mockUseConfig = jest.fn();

// Mock the console.error to avoid polluting test output
const originalConsoleError = console.error;
beforeEach(() => {
  console.error = jest.fn();
});

afterEach(() => {
  console.error = originalConsoleError;
});

jest.unstable_mockModule("../../src/handlers/access.ts", () => ({
  __esModule: true,
  default: mockCheckAccessLevel,
}));

jest.unstable_mockModule("../../src/helpers/history.ts", () => ({
  addToHistory: mockAddToHistory,
  forgetHistoryOnTimeout: jest.fn(),
  forgetHistory: jest.fn(),
  initThread: jest.fn(() => ({
    id: 1,
    msgs: [],
    messages: [],
    completionParams: {},
  })),
}));

jest.unstable_mockModule("../../src/handlers/resolveChatButtons.ts", () => ({
  __esModule: true,
  default: mockResolveChatButtons,
}));

jest.unstable_mockModule("../../src/helpers/gpt.ts", () => ({
  requestGptAnswer: mockRequestGptAnswer,
  generateButtonsFromAgent: mockGenerateButtonsFromAgent,
}));

jest.unstable_mockModule("../../src/telegram/send.ts", () => ({
  sendTelegramMessage: mockSendTelegramMessage,
  sendTelegramDocument: jest.fn(),
  editTelegramMessage: jest.fn(),
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
  updateChatInConfig: jest.fn(),
}));

jest.unstable_mockModule("../../src/threads.ts", () => ({
  useThreads: () => threads,
}));

let handlers: typeof import("../../src/handlers/onTextMessage.ts");
let onTextMessage: typeof import("../../src/handlers/onTextMessage.ts").default;

function createCtx(message: Record<string, unknown>): Context & { secondTry?: boolean } {
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

beforeAll(async () => {
  // Load the module after setting up all mocks
  handlers = await import("../../src/handlers/onTextMessage.ts");
  onTextMessage = handlers.default;
});

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  // Reset global state before each test
  global.firstAbortController = undefined;
  global.secondAbortController = undefined;

  // Reload the module for each test to ensure a clean state
  handlers = await import("../../src/handlers/onTextMessage.ts");
  onTextMessage = handlers.default;

  // Setup default mocks with proper type annotations
  mockUseConfig.mockReturnValue({ auth: {} });
  mockResolveChatButtons.mockImplementation((msg) => msg);
  mockAddToHistory.mockImplementation((msg) => msg);
  mockCheckAccessLevel.mockImplementation(async (ctx) => {
    const msg = (ctx as { message?: Message.TextMessage }).message || ({} as Message.TextMessage);
    return { msg, chat: baseChat };
  });
  mockRequestGptAnswer.mockResolvedValue({ content: "ok" });
  mockGenerateButtonsFromAgent.mockResolvedValue(undefined);
  mockSendTelegramMessage.mockResolvedValue({
    chat: { id: 1 },
  } as unknown as Message.TextMessage);
  threads[1] = { id: 1, msgs: [], messages: [], completionParams: {} };
});

afterEach(() => {
  jest.useRealTimers();
  // Clean up global state after each test
  global.firstAbortController = undefined;
  global.secondAbortController = undefined;
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

  it("aborts the first response when a second arrives", async () => {
    const msg1 = {
      chat: { id: 1, type: "private" },
      from: { id: 1 },
      text: "first",
    } as Message.TextMessage;
    const msg2 = {
      chat: { id: 1, type: "private" },
      from: { id: 1 },
      text: "second",
    } as Message.TextMessage;

    const chat = baseChat;

    const abortSignals: AbortSignal[] = [];
    let resolveFirst: () => void = () => {};

    mockCheckAccessLevel.mockResolvedValueOnce({ msg: msg1, chat });
    mockCheckAccessLevel.mockResolvedValueOnce({ msg: msg2, chat });
    mockResolveChatButtons.mockImplementation(() => undefined);

    mockRequestGptAnswer
      .mockImplementationOnce((_m, _c, _ctx, opts) => {
        abortSignals.push(opts?.signal as AbortSignal);
        return new Promise<{ content: string }>((r) => {
          resolveFirst = () => r({ content: "first" });
        });
      })
      .mockImplementationOnce((_m, _c, _ctx, opts) => {
        abortSignals.push(opts?.signal as AbortSignal);
        return Promise.resolve({ content: "second" });
      });

    await onTextMessage(createCtx(msg1), undefined, jest.fn());
    await Promise.resolve();
    await onTextMessage(createCtx(msg2), undefined, jest.fn());

    expect(abortSignals[0]?.aborted).toBe(true);

    // cleanup
    resolveFirst();
    await jest.runAllTimersAsync();
  });

  it("aborts button generation when cancelling a previous response", async () => {
    const msg1 = {
      chat: { id: 1, type: "private" },
      from: { id: 1 },
      text: "first",
      message_id: 1,
    } as Message.TextMessage;
    const msg2 = {
      chat: { id: 1, type: "private" },
      from: { id: 1 },
      text: "second",
      message_id: 2,
    } as Message.TextMessage;

    const chat: ConfigChatType = { ...baseChat, chatParams: { responseButtonsAgent: true } };

    mockCheckAccessLevel.mockResolvedValueOnce({ msg: msg1, chat });
    mockCheckAccessLevel.mockResolvedValueOnce({ msg: msg2, chat });
    mockResolveChatButtons.mockImplementation(() => undefined);

    let resolveButtons: ((value: unknown) => void) | undefined;
    let buttonsSignal: AbortSignal | undefined;
    mockGenerateButtonsFromAgent.mockImplementation((_answer, _msg, options) => {
      buttonsSignal = options?.signal;
      return new Promise((resolve) => {
        resolveButtons = resolve;
      });
    });

    mockSendTelegramMessage.mockResolvedValue({
      chat: { id: 1 },
      message_id: 99,
      text: "first response",
    } as Message.TextMessage);

    await onTextMessage(createCtx(msg1), undefined, jest.fn());
    await Promise.resolve();
    await onTextMessage(createCtx(msg2), undefined, jest.fn());

    expect(buttonsSignal?.aborted).toBe(true);

    resolveButtons?.([]);
    await jest.runAllTimersAsync();
  });
});
