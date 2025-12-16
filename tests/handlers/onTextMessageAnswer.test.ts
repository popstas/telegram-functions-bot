import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Context, Message } from "telegraf/types";
import type { ConfigChatType } from "../../src/types.ts";

type AbortSignal = {
  readonly aborted: boolean;
  onabort: ((this: AbortSignal, ev: Event) => void) | null;
  addEventListener: (type: "abort", listener: () => void) => void;
  removeEventListener: (type: "abort", listener: () => void) => void;
  dispatchEvent: (event: Event) => boolean;
};

const threads: Record<
  number,
  {
    id: number;
    msgs: Message[];
    messages: Message[];
    completionParams: Record<string, unknown>;
    dynamicButtons?: { name: string; prompt: string }[];
  }
> = {
  1: {
    id: 1,
    msgs: [],
    messages: [],
    completionParams: {},
    dynamicButtons: undefined,
  },
};

const mockEnsureAuth = jest.fn();
const mockAddOauthToThread = jest.fn();
const mockSyncButtons = jest.fn();
// Mock implementations
const mockRequestGptAnswer = jest.fn();
const mockSendTelegramMessage = jest.fn();
const mockEditTelegramMessage = jest.fn();
const mockUseConfig = jest.fn();
const mockGenerateButtonsFromAgent = jest.fn();

// Default mock implementations
mockRequestGptAnswer.mockImplementation(() => Promise.resolve({ content: "hi" }));
mockSendTelegramMessage.mockImplementation(() =>
  Promise.resolve({ chat: { id: 1 } } as Message.TextMessage),
);
mockGenerateButtonsFromAgent.mockResolvedValue(undefined);

jest.unstable_mockModule("../../src/helpers/google.ts", () => ({
  ensureAuth: mockEnsureAuth,
  addOauthToThread: mockAddOauthToThread,
}));

jest.unstable_mockModule("../../src/config.ts", () => ({
  useConfig: () => mockUseConfig(),
  syncButtons: mockSyncButtons,
  updateChatInConfig: jest.fn(),
}));

jest.unstable_mockModule("../../src/helpers/gpt.ts", () => ({
  requestGptAnswer: mockRequestGptAnswer,
  generateButtonsFromAgent: mockGenerateButtonsFromAgent,
}));

jest.unstable_mockModule("../../src/telegram/send.ts", () => ({
  sendTelegramMessage: mockSendTelegramMessage,
  editTelegramMessage: mockEditTelegramMessage,
  sendTelegramDocument: jest.fn(),
  getFullName: jest.fn(),
  getTelegramForwardedUser: jest.fn(),
  isAdminUser: jest.fn(),
  buildButtonRows: jest.fn(),
  isOurUser: jest.fn(),
}));

jest.unstable_mockModule("../../src/threads.ts", () => ({
  useThreads: () => threads,
}));

let handlers: typeof import("../../src/handlers/onTextMessage.ts");

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

beforeEach(async () => {
  jest.clearAllMocks();
  jest.resetModules();
  threads[1].msgs = [];
  threads[1].dynamicButtons = undefined;
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
    // Setup
    mockUseConfig.mockReturnValue({ auth: {} });

    // Mock the response from requestGptAnswer
    mockRequestGptAnswer.mockImplementationOnce(async () => ({
      content: "hi",
    }));

    // Mock the response from sendTelegramMessage
    const mockMessage = {
      chat: { id: 1 },
      message_id: 123,
      date: Date.now() / 1000,
      text: "hi",
    } as Message.TextMessage;
    mockSendTelegramMessage.mockImplementationOnce(async () => mockMessage);

    // Test data
    const msg = {
      chat: { id: 1, title: "t" },
      from: { id: 1, first_name: "Test" },
      text: "hello",
      message_id: 1,
      date: Date.now() / 1000,
    } as Message.TextMessage;

    const ctx = createCtx(msg);
    const chat = { ...baseChat, buttons: [{ name: "b" }] };

    // Create a mock AbortSignal
    const abortController = {
      signal: {
        aborted: false,
        onabort: null,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      },
    };

    // Execute
    const res = await handlers.answerToMessage(ctx, msg, chat, {
      signal: abortController.signal,
    });

    // Verify requestGptAnswer was called correctly
    expect(mockRequestGptAnswer).toHaveBeenCalledWith(
      msg,
      chat,
      ctx,
      expect.objectContaining({ signal: abortController.signal }),
    );

    // Verify sendTelegramMessage was called correctly
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(1, "hi", expect.anything(), ctx, chat);

    // Verify the message was added to history
    expect(threads[1].msgs.length).toBe(1);
    expect(res).toBeDefined();
  });

  it("uses default text when gpt answer empty", async () => {
    mockUseConfig.mockReturnValue({ auth: {} });
    mockRequestGptAnswer.mockResolvedValue({});
    mockSendTelegramMessage.mockResolvedValue({
      chat: { id: 1 },
    } as unknown as Message.TextMessage);
    const msg = {
      chat: { id: 1, title: "t" },
      from: { id: 1 },
      text: "hello",
    } as Message.TextMessage;
    const ctx = createCtx(msg);
    const chat = { ...baseChat };
    await handlers.answerToMessage(ctx, msg, chat, {});
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      1,
      "бот не ответил",
      expect.anything(),
      ctx,
      chat,
    );
  });

  it("shows dynamic buttons from model response", async () => {
    mockUseConfig.mockReturnValue({ auth: {} });
    mockRequestGptAnswer.mockResolvedValueOnce({
      content: "hi",
      buttons: [{ name: "B", prompt: "p" }],
    });
    mockSendTelegramMessage.mockResolvedValueOnce({
      chat: { id: 1 },
    } as unknown as Message.TextMessage);
    const msg = {
      chat: { id: 1, title: "t" },
      from: { id: 1 },
      text: "hello",
      message_id: 1,
      date: 0,
    } as Message.TextMessage;
    const ctx = createCtx(msg);
    const chat = { ...baseChat, chatParams: { responseButtons: true } };

    await handlers.answerToMessage(ctx, msg, chat, {});

    const extraParams = mockSendTelegramMessage.mock.calls[0][2];
    expect(extraParams.reply_markup.keyboard.flat()).toContain("B");
    expect(threads[1].dynamicButtons).toEqual([{ name: "B", prompt: "p" }]);
    const expectedFormat = {
      type: "json_schema",
      json_schema: {
        name: "response",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            message: { type: "string" },
            buttons: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string", description: "Short name" },
                  prompt: { type: "string" },
                },
                required: ["name", "prompt"],
              },
            },
          },
          required: ["message", "buttons"],
        },
      },
    };
    expect(mockRequestGptAnswer).toHaveBeenCalledWith(
      msg,
      chat,
      ctx,
      expect.objectContaining({ responseFormat: expectedFormat }),
    );
  });

  it("edits message after sending when using buttons agent", async () => {
    mockUseConfig.mockReturnValue({ auth: {} });
    const callOrder: string[] = [];
    const sentMessage = {
      chat: { id: 1 },
      message_id: 10,
      text: "hi",
    } as Message.TextMessage;
    mockSendTelegramMessage.mockImplementationOnce(async () => {
      callOrder.push("send");
      return sentMessage;
    });
    mockGenerateButtonsFromAgent.mockImplementationOnce(async () => {
      callOrder.push("generate");
      return [{ name: "Next", prompt: "do" }];
    });
    mockEditTelegramMessage.mockImplementationOnce(async (_m, _t, extraParams) => {
      callOrder.push("edit");
      return {
        ...sentMessage,
        message_id: 11,
        ...(extraParams as object),
      } as Message.TextMessage;
    });
    const msg = {
      chat: { id: 1, title: "t" },
      from: { id: 1 },
      text: "hello",
      message_id: 1,
      date: 0,
    } as Message.TextMessage;
    const ctx = createCtx(msg);
    const chat = { ...baseChat, chatParams: { responseButtonsAgent: true } };

    await handlers.answerToMessage(ctx, msg, chat, {});

    expect(callOrder).toEqual(["send", "generate", "edit"]);
    const extraParams = mockEditTelegramMessage.mock.calls[0][2] as {
      reply_markup: { keyboard: (string | { text: string })[][] };
    };
    const buttonNames = extraParams.reply_markup.keyboard
      .flat()
      .map((b) => (typeof b === "string" ? b : b.text));
    expect(buttonNames).toContain("Next");
    expect(threads[1].dynamicButtons).toEqual([{ name: "Next", prompt: "do" }]);
  });

  it("handles errors", async () => {
    mockUseConfig.mockReturnValue({ auth: {} });
    mockRequestGptAnswer.mockRejectedValue(new Error("bad"));
    mockSendTelegramMessage.mockResolvedValue({
      chat: { id: 1 },
    } as unknown as Message.TextMessage);
    const msg = {
      chat: { id: 1, title: "t" },
      from: { id: 1 },
      text: "hello",
    } as Message.TextMessage;
    const ctx = createCtx(msg);
    const chat = { ...baseChat };
    const res = await handlers.answerToMessage(ctx, msg, chat, {});
    expect(res).toBeDefined();
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      1,
      expect.stringContaining("bad"),
      {},
      ctx,
      chat,
    );
  });
});
