import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Context } from "grammy";
import type { Message } from "grammy/types";

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

jest.unstable_mockModule("../../src/handlers/access.ts", () => ({
  __esModule: true,
  isGuestModeReply: () => false,
  shouldIncludeReplyInHistory: () => false,
  default: (...args: unknown[]) => mockCheckAccessLevel(...args),
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

describe("onTextMessage outer", () => {
  it("returns early when access denied", async () => {
    mockCheckAccessLevel.mockResolvedValue(false);
    const ctx = createCtx({} as Message.TextMessage);
    await onTextMessage(ctx);
    expect(mockAddToHistory).not.toHaveBeenCalled();
  });

  it("handles button response", async () => {
    const msg = { chat: { id: 1 }, text: "hi" } as Message.TextMessage;
    mockCheckAccessLevel.mockResolvedValue({
      msg,
      chat: { completionParams: {} },
    });
    mockResolveChatButtons.mockResolvedValue("ok");
    const ctx = createCtx(msg);
    const res = await onTextMessage(ctx);
    expect(res).toBe("ok");
    expect(mockAddToHistory).not.toHaveBeenCalled();
  });

  it("answers edited_message updates without throwing (ctx.message is undefined)", async () => {
    // grammY derives ctx.message only from update.message; an edited_message
    // update leaves ctx.message undefined while msg comes from access. The
    // chatTitle lookup must read msg.chat, not ctx.message?.chat.
    const msg = {
      chat: { id: 1, title: "Group" },
      text: "edited hi",
      message_id: 42,
    } as unknown as Message.TextMessage;
    mockCheckAccessLevel.mockResolvedValue({
      msg,
      chat: { completionParams: {} },
    });
    mockResolveChatButtons.mockResolvedValue("ok");
    const ctx = {
      message: undefined,
      update: { edited_message: msg },
      persistentChatAction: async (_: string, fn: () => Promise<void>) => {
        await fn();
      },
    } as unknown as Context & { secondTry?: boolean };

    // Does not throw (rejection would fail the resolves assertion) and an
    // answer was attempted via the button path.
    await expect(onTextMessage(ctx)).resolves.toBe("ok");
  });
});
