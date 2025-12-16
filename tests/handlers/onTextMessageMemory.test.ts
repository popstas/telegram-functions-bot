import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Context, Message } from "telegraf/types";
import type { ConfigChatType } from "../../src/types.ts";

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
const mockSaveEmbedding = jest.fn();
const mockSendTelegramMessage = jest.fn();
const mockResolveChatButtons = jest.fn();
const mockAddToHistory = jest.fn();

jest.unstable_mockModule("../../src/handlers/access.ts", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockCheckAccessLevel(...args),
}));

jest.unstable_mockModule("../../src/helpers/embeddings.ts", () => ({
  saveEmbedding: (...args: unknown[]) => mockSaveEmbedding(...args),
}));

jest.unstable_mockModule("../../src/helpers/history.ts", () => ({
  addToHistory: (...args: unknown[]) => mockAddToHistory(...args),
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
  default: (...args: unknown[]) => mockResolveChatButtons(...args),
}));

jest.unstable_mockModule("../../src/telegram/send.ts", () => ({
  sendTelegramMessage: (...args: unknown[]) => mockSendTelegramMessage(...args),
  sendTelegramDocument: jest.fn(),
  editTelegramMessage: jest.fn(),
  getFullName: jest.fn(),
  getTelegramForwardedUser: jest.fn(),
  isAdminUser: jest.fn(),
  buildButtonRows: jest.fn(),
  isOurUser: jest.fn(),
}));

jest.unstable_mockModule("../../src/threads.ts", () => ({
  useThreads: () => threads,
}));

let onTextMessage: (ctx: Context & { secondTry?: boolean }) => Promise<void>;

function createCtx(message: Record<string, unknown>): Context & { secondTry?: boolean } {
  return {
    message,
    update: { message },
    persistentChatAction: async (_: string, fn: () => Promise<void>) => {
      await fn();
    },
  } as unknown as Context & { secondTry?: boolean };
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.resetModules();
  onTextMessage = (await import("../../src/handlers/onTextMessage.ts")).default;
});

describe("onTextMessage memory", () => {
  it("saves embedding without punctuation", async () => {
    const msg = {
      chat: { id: 1, title: "t" },
      from: { id: 2 },
      text: "запомни: hello world",
      message_id: 42,
    } as Message.TextMessage;
    const chat: ConfigChatType = {
      name: "c",
      id: 1,
      completionParams: {},
      chatParams: { vector_memory: true },
      toolParams: {},
    } as ConfigChatType;
    mockCheckAccessLevel.mockResolvedValue({ msg, chat });
    const ctx = createCtx(msg);
    await onTextMessage(ctx);
    expect(mockSaveEmbedding).toHaveBeenCalledWith({
      text: "hello world",
      metadata: { chatId: 1, userId: 2, messageId: 42 },
      chat,
    });
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(1, "Запомнил", undefined, ctx, chat);
    expect(mockAddToHistory).not.toHaveBeenCalled();
  });

  it("saves embedding when message has prefix", async () => {
    const msg = {
      chat: { id: 1, title: "t" },
      from: { id: 2 },
      text: "бот, запомни: hello world",
      message_id: 43,
    } as Message.TextMessage;
    const chat: ConfigChatType = {
      name: "c",
      id: 1,
      completionParams: {},
      chatParams: { vector_memory: true },
      toolParams: {},
      prefix: "бот",
    } as ConfigChatType;
    mockCheckAccessLevel.mockResolvedValue({ msg, chat });
    const ctx = createCtx(msg);
    await onTextMessage(ctx);
    expect(mockSaveEmbedding).toHaveBeenCalledWith({
      text: "hello world",
      metadata: { chatId: 1, userId: 2, messageId: 43 },
      chat,
    });
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(1, "Запомнил", undefined, ctx, chat);
    expect(mockAddToHistory).not.toHaveBeenCalled();
  });
});
