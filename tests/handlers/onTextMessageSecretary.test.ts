import { jest, describe, it, expect, beforeEach, afterEach, beforeAll } from "@jest/globals";
import type { Context, Message } from "telegraf/types";
import type { ConfigChatType } from "../../src/types.ts";

interface Thread {
  id: number;
  msgs: Message[];
  messages: Message[];
  completionParams: Record<string, unknown>;
  nextSystemMessage?: string;
}

const sharedThread: Thread = { id: 1, msgs: [], messages: [], completionParams: {} };
const threads: Record<number, Thread> = { 1: sharedThread };

const mockCheckAccessLevel = jest.fn<
  Promise<{ msg: Message.TextMessage; chat: ConfigChatType } | false | undefined>,
  [Context]
>();
const mockAddToHistory = jest.fn<Message.TextMessage, [Message.TextMessage]>();
const mockResolveChatButtons = jest.fn<Message.TextMessage | undefined, [Message.TextMessage]>();
const mockGenerateButtonsFromAgent = jest.fn();
const mockRequestGptAnswer = jest.fn(() => Promise.resolve({ content: "ok" })) as jest.Mock;
const mockSendTelegramMessage = jest.fn(() =>
  Promise.resolve({ chat: { id: 1 }, message_id: 100, text: "ok" } as Message.TextMessage),
);
const mockUseConfig = jest.fn();
const mockLog = jest.fn();

beforeEach(() => {
  console.error = jest.fn();
});

jest.unstable_mockModule("../../src/helpers.ts", () => ({
  __esModule: true,
  log: (...args: unknown[]) => mockLog(...args),
  subscribeToLogs: jest.fn(),
  ensureDirectoryExists: jest.fn(),
  safeFilename: (filename: string, def: string) => filename || def,
  sendToHttp: jest.fn(),
  agentNameToId: (name: string) =>
    -Math.abs([...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0)),
  stringToId: (name: string) =>
    -Math.abs([...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0)),
}));

jest.unstable_mockModule("../../src/handlers/access.ts", () => ({
  __esModule: true,
  isGuestModeReply: () => false,
  default: mockCheckAccessLevel,
}));

jest.unstable_mockModule("../../src/helpers/history.ts", () => ({
  addToHistory: mockAddToHistory,
  forgetHistoryOnTimeout: jest.fn(),
  forgetHistory: jest.fn(),
  initThread: jest.fn(() => sharedThread),
}));

jest.unstable_mockModule("../../src/handlers/resolveChatButtons.ts", () => ({
  __esModule: true,
  default: mockResolveChatButtons,
}));

jest.unstable_mockModule("../../src/handlers/formFlow.ts", () => ({
  handleFormFlow: jest.fn(() => Promise.resolve(undefined)),
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

function makeMsg(text: string, message_id: number, username?: string): Message.TextMessage {
  return {
    chat: { id: 1, type: "private" },
    from: { id: 1, username },
    text,
    message_id,
  } as Message.TextMessage;
}

beforeAll(async () => {
  handlers = await import("../../src/handlers/onTextMessage.ts");
  onTextMessage = handlers.default;
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockLog.mockReset();
  handlers.__testSecretary.clear();
  delete sharedThread.nextSystemMessage;
  mockUseConfig.mockReturnValue({ auth: {} });
  mockResolveChatButtons.mockImplementation(() => undefined);
  mockAddToHistory.mockImplementation((msg) => msg);
  mockRequestGptAnswer.mockResolvedValue({ content: "ok" });
  mockGenerateButtonsFromAgent.mockResolvedValue(undefined);
  mockSendTelegramMessage.mockResolvedValue({ chat: { id: 1 } } as unknown as Message.TextMessage);
});

afterEach(() => {
  handlers.__testSecretary.clear();
  jest.useRealTimers();
});

const loggedMessages = (): string[] =>
  (mockLog.mock.calls as unknown[][]).map((c) => (c[0] as { msg: string }).msg);

describe("onTextMessage secretary mode", () => {
  const secretaryChat: ConfigChatType = {
    name: "chat",
    completionParams: {},
    chatParams: { secretary: { firstAnswerDelay: 15 } },
    toolParams: {},
  } as ConfigChatType;

  it("does not answer immediately, answers once after the delay", async () => {
    const msg = makeMsg("hi", 1);
    mockCheckAccessLevel.mockResolvedValue({ msg, chat: secretaryChat });

    await onTextMessage(createCtx(msg));

    expect(mockAddToHistory).toHaveBeenCalledTimes(1);
    expect(mockRequestGptAnswer).not.toHaveBeenCalled();
    expect(loggedMessages()).toContainEqual(expect.stringContaining("secretary: waiting 15s"));

    await jest.advanceTimersByTimeAsync(15000);

    expect(mockRequestGptAnswer).toHaveBeenCalledTimes(1);
    expect(loggedMessages()).toContainEqual(expect.stringContaining("secretary: delay elapsed"));
  });

  it("batches rapid follow-ups into a single answer", async () => {
    const msg1 = makeMsg("a", 1);
    const msg2 = makeMsg("b", 2);
    const msg3 = makeMsg("c", 3);
    mockCheckAccessLevel
      .mockResolvedValueOnce({ msg: msg1, chat: secretaryChat })
      .mockResolvedValueOnce({ msg: msg2, chat: secretaryChat })
      .mockResolvedValueOnce({ msg: msg3, chat: secretaryChat });

    await onTextMessage(createCtx(msg1));
    await jest.advanceTimersByTimeAsync(5000);
    await onTextMessage(createCtx(msg2));
    await jest.advanceTimersByTimeAsync(5000);
    await onTextMessage(createCtx(msg3));

    // All three added to history, but no answer yet.
    expect(mockAddToHistory).toHaveBeenCalledTimes(3);
    expect(mockRequestGptAnswer).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(15000);

    expect(mockRequestGptAnswer).toHaveBeenCalledTimes(1);
  });

  it("applies secretary.prompt as the system message override", async () => {
    const chat: ConfigChatType = {
      ...secretaryChat,
      chatParams: { secretary: { firstAnswerDelay: 10, prompt: "act as secretary" } },
    } as ConfigChatType;
    const msg = makeMsg("hi", 1);
    mockCheckAccessLevel.mockResolvedValue({ msg, chat });

    await onTextMessage(createCtx(msg));
    await jest.advanceTimersByTimeAsync(10000);

    expect(sharedThread.nextSystemMessage).toBe("act as secretary");
    expect(mockRequestGptAnswer).toHaveBeenCalledTimes(1);
  });

  it("answers immediately when secretary mode is disabled", async () => {
    const chat: ConfigChatType = {
      name: "chat",
      completionParams: {},
      chatParams: {},
      toolParams: {},
    } as ConfigChatType;
    const msg = makeMsg("hi", 1);
    mockCheckAccessLevel.mockResolvedValue({ msg, chat });

    await onTextMessage(createCtx(msg), undefined, jest.fn());
    await Promise.resolve();

    expect(mockRequestGptAnswer).toHaveBeenCalledTimes(1);
    expect(handlers.__testSecretary.has(1)).toBe(false);
    await jest.runAllTimersAsync();
  });

  it("bypasses the debounce when a callback is supplied (HTTP interface)", async () => {
    const msg = makeMsg("hi", 1);
    mockCheckAccessLevel.mockResolvedValue({ msg, chat: secretaryChat });

    // The HTTP path passes a callback that ends the response; deferring it into
    // the secretary timer would hang the request, so it must answer immediately.
    await onTextMessage(createCtx(msg), undefined, jest.fn());
    await Promise.resolve();

    expect(mockRequestGptAnswer).toHaveBeenCalledTimes(1);
    expect(handlers.__testSecretary.has(1)).toBe(false);
    await jest.runAllTimersAsync();
  });

  const sessionChat: ConfigChatType = {
    name: "chat",
    completionParams: {},
    chatParams: { secretary: { firstAnswerDelay: 15, sessionDurationSeconds: 600 } },
    toolParams: {},
  } as ConfigChatType;

  it("answers immediately for follow-ups within an active session", async () => {
    const msg1 = makeMsg("hi", 1);
    const msg2 = makeMsg("again", 2);
    mockCheckAccessLevel
      .mockResolvedValueOnce({ msg: msg1, chat: sessionChat })
      .mockResolvedValueOnce({ msg: msg2, chat: sessionChat });

    // First message of the session is debounced.
    await onTextMessage(createCtx(msg1));
    expect(mockRequestGptAnswer).not.toHaveBeenCalled();
    expect(loggedMessages()).toContainEqual(expect.stringContaining("secretary: waiting 15s"));
    await jest.advanceTimersByTimeAsync(15000);
    expect(mockRequestGptAnswer).toHaveBeenCalledTimes(1);

    // Session is now active: a follow-up answers immediately, no second wait.
    mockLog.mockReset();
    await onTextMessage(createCtx(msg2));
    await jest.advanceTimersByTimeAsync(0);
    expect(mockRequestGptAnswer).toHaveBeenCalledTimes(2);
    expect(loggedMessages()).toContainEqual(
      expect.stringContaining("secretary: session active, answering immediately"),
    );
    expect(loggedMessages()).not.toContainEqual(expect.stringContaining("secretary: waiting"));
  });

  it("debounces again after the session expires (inactivity)", async () => {
    const msg1 = makeMsg("hi", 1);
    const msg2 = makeMsg("later", 2);
    mockCheckAccessLevel
      .mockResolvedValueOnce({ msg: msg1, chat: sessionChat })
      .mockResolvedValueOnce({ msg: msg2, chat: sessionChat });

    await onTextMessage(createCtx(msg1));
    await jest.advanceTimersByTimeAsync(15000);
    expect(mockRequestGptAnswer).toHaveBeenCalledTimes(1);

    // Quiet for longer than sessionDurationSeconds → next message starts a new
    // session and is debounced again.
    await jest.advanceTimersByTimeAsync(601_000);
    mockLog.mockReset();
    await onTextMessage(createCtx(msg2));
    expect(mockRequestGptAnswer).toHaveBeenCalledTimes(1);
    expect(handlers.__testSecretary.has(1)).toBe(true);
    expect(loggedMessages()).toContainEqual(expect.stringContaining("secretary: waiting 15s"));

    await jest.advanceTimersByTimeAsync(15000);
    expect(mockRequestGptAnswer).toHaveBeenCalledTimes(2);
  });

  it("suppresses auto-answers after the owner replies manually, until the session ends", async () => {
    const msg1 = makeMsg("hi", 1);
    const msg2 = makeMsg("still there?", 2);
    const msg3 = makeMsg("hello again", 3);
    mockCheckAccessLevel
      .mockResolvedValueOnce({ msg: msg1, chat: sessionChat })
      .mockResolvedValueOnce({ msg: msg2, chat: sessionChat })
      .mockResolvedValueOnce({ msg: msg3, chat: sessionChat });

    // Establish a session and answer the opener.
    await onTextMessage(createCtx(msg1));
    await jest.advanceTimersByTimeAsync(15000);
    expect(mockRequestGptAnswer).toHaveBeenCalledTimes(1);

    // Owner takes over this chat manually.
    handlers.noteSecretaryHumanReply(1);

    // Customer keeps writing within the session → bot stays silent.
    mockLog.mockReset();
    await onTextMessage(createCtx(msg2));
    await jest.advanceTimersByTimeAsync(0);
    expect(mockRequestGptAnswer).toHaveBeenCalledTimes(1);
    expect(loggedMessages()).toContainEqual(
      expect.stringContaining("secretary: suppressed (owner handling this session)"),
    );

    // After the session goes quiet, a new session resumes auto-answers.
    await jest.advanceTimersByTimeAsync(601_000);
    await onTextMessage(createCtx(msg3));
    expect(handlers.__testSecretary.has(1)).toBe(true);
    await jest.advanceTimersByTimeAsync(15000);
    expect(mockRequestGptAnswer).toHaveBeenCalledTimes(2);
  });

  const usernamesChat: ConfigChatType = {
    name: "chat",
    completionParams: {},
    chatParams: {
      secretary: {
        firstAnswerDelay: 10,
        prompt: "base prompt",
        usernames: [
          { username: "VipClient", prompt: "vip extra", override: false },
          { username: "boss", prompt: "boss only", override: true },
        ],
      },
    },
    toolParams: {},
  } as ConfigChatType;

  it("appends the per-username prompt when override is false (case-insensitive)", async () => {
    const msg = makeMsg("hi", 1, "vipclient");
    mockCheckAccessLevel.mockResolvedValue({ msg, chat: usernamesChat });

    await onTextMessage(createCtx(msg));
    await jest.advanceTimersByTimeAsync(10000);

    expect(sharedThread.nextSystemMessage).toBe("base prompt\n\nvip extra");
  });

  it("replaces the prompt when override is true", async () => {
    const msg = makeMsg("hi", 1, "boss");
    mockCheckAccessLevel.mockResolvedValue({ msg, chat: usernamesChat });

    await onTextMessage(createCtx(msg));
    await jest.advanceTimersByTimeAsync(10000);

    expect(sharedThread.nextSystemMessage).toBe("boss only");
  });

  it("uses the base prompt for a non-matching username", async () => {
    const msg = makeMsg("hi", 1, "someone_else");
    mockCheckAccessLevel.mockResolvedValue({ msg, chat: usernamesChat });

    await onTextMessage(createCtx(msg));
    await jest.advanceTimersByTimeAsync(10000);

    expect(sharedThread.nextSystemMessage).toBe("base prompt");
  });
});
