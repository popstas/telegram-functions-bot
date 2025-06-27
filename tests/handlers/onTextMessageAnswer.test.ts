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

const mockEnsureAuth = jest.fn();
const mockAddOauthToThread = jest.fn();
const mockSyncButtons = jest.fn();
const mockRequestGptAnswer = jest.fn();
const mockSendTelegramMessage = jest.fn();
const mockUseConfig = jest.fn();

jest.unstable_mockModule("../../src/helpers/google.ts", () => ({
  ensureAuth: (...args: unknown[]) => mockEnsureAuth(...args),
  addOauthToThread: (...args: unknown[]) => mockAddOauthToThread(...args),
}));

jest.unstable_mockModule("../../src/config.ts", () => ({
  useConfig: () => mockUseConfig(),
  syncButtons: (...args: unknown[]) => mockSyncButtons(...args),
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

jest.unstable_mockModule("../../src/threads.ts", () => ({
  useThreads: () => threads,
}));

let handlers: typeof import("../../src/handlers/onTextMessage.ts");

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
  jest.clearAllMocks();
  jest.resetModules();
  handlers = await import("../../src/handlers/onTextMessage.ts");
});

describe("answerToMessage", () => {
  it("handles sync buttons", async () => {
    mockUseConfig.mockReturnValue({
      auth: { oauth_google: { client_id: "id" } },
    });
    mockEnsureAuth.mockResolvedValue("auth");
    mockSyncButtons.mockResolvedValue([{ name: "b" }]);
    mockSendTelegramMessage.mockResolvedValue({
      chat: { id: 1 },
    } as unknown as Message.TextMessage);
    const msg = {
      chat: { id: 1, title: "t" },
      from: { id: 1 },
      text: "sync",
    } as Message.TextMessage;
    const ctx = createCtx(msg);
    const chat = { ...baseChat, buttonsSync: true };
    const res = await handlers.answerToMessage(ctx, msg, chat, {});
    expect(mockSyncButtons).toHaveBeenCalled();
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      1,
      expect.stringContaining("Готово"),
      expect.anything(),
      ctx,
      chat,
    );
    expect(res).toBeDefined();
  });

  it("sends gpt answer and stores message", async () => {
    mockUseConfig.mockReturnValue({ auth: {} });
    mockRequestGptAnswer.mockResolvedValue({ content: "hi" });
    mockSendTelegramMessage.mockResolvedValue({
      chat: { id: 1 },
    } as unknown as Message.TextMessage);
    const msg = {
      chat: { id: 1, title: "t" },
      from: { id: 1 },
      text: "hello",
    } as Message.TextMessage;
    const ctx = createCtx(msg);
    const chat = { ...baseChat, buttons: [{ name: "b" }] };
    const res = await handlers.answerToMessage(ctx, msg, chat, {});
    expect(mockRequestGptAnswer).toHaveBeenCalledWith(msg, chat, ctx);
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      1,
      "hi",
      expect.anything(),
      ctx,
      chat,
    );
    expect(threads[1].msgs.length).toBe(1);
    expect(res).toBeDefined();
  });
});
