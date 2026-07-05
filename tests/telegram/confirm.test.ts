import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Message } from "grammy/types";
import type { ConfigChatType } from "../../src/types.ts";

const mockSendTelegramMessage = jest.fn();

jest.unstable_mockModule("../../src/telegram/send.ts", () => ({
  __esModule: true,
  sendTelegramMessage: (...args: unknown[]) => mockSendTelegramMessage(...args),
}));

let telegramConfirm: typeof import("../../src/telegram/confirm.ts").telegramConfirm;
let registerConfirmActions: typeof import("../../src/telegram/confirm.ts").registerConfirmActions;
let __testConfirm: typeof import("../../src/telegram/confirm.ts").__testConfirm;

function createMsg(): Message.TextMessage {
  return {
    chat: { id: 1, type: "private" },
    from: { id: 10, username: "user" },
    text: "hi",
  } as Message.TextMessage;
}

function createChat(): ConfigChatType {
  return {
    bot_token: "token",
    completionParams: {},
    chatParams: {},
    toolParams: {},
  } as ConfigChatType;
}

function createFakeBot() {
  return { callbackQuery: jest.fn() };
}

beforeEach(async () => {
  jest.resetModules();
  mockSendTelegramMessage.mockReset();
  mockSendTelegramMessage.mockResolvedValue(undefined);
  ({ telegramConfirm, registerConfirmActions, __testConfirm } = await import(
    "../../src/telegram/confirm.ts"
  ));
  __testConfirm.reset();
});

describe("telegramConfirm", () => {
  it("resolves onConfirm result when confirm button clicked by the same user", async () => {
    const fakeBot = createFakeBot();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerConfirmActions(fakeBot as any);
    const handler = fakeBot.callbackQuery.mock.calls[0][1] as (ctx: unknown) => Promise<void>;

    const msg = createMsg();
    const chatConfig = createChat();
    const resultPromise = telegramConfirm({
      chatId: 1,
      msg,
      chatConfig,
      text: "Are you sure?",
      onConfirm: async () => 42,
      onCancel: async () => 0,
    });
    await Promise.resolve();
    expect(mockSendTelegramMessage).toHaveBeenCalled();

    const answerCallbackQuery = jest.fn();
    await handler({
      match: ["confirm_1", "confirm", "1"],
      from: { id: 10 },
      answerCallbackQuery,
    });
    expect(answerCallbackQuery).toHaveBeenCalledWith();
    await expect(resultPromise).resolves.toBe(42);
  });

  it("resolves onCancel result when cancel clicked", async () => {
    const fakeBot = createFakeBot();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerConfirmActions(fakeBot as any);
    const handler = fakeBot.callbackQuery.mock.calls[0][1] as (ctx: unknown) => Promise<void>;

    const msg = createMsg();
    const chatConfig = createChat();
    const resultPromise = telegramConfirm({
      chatId: 1,
      msg,
      chatConfig,
      text: "Are you sure?",
      onConfirm: async () => 1,
      onCancel: async () => -1,
    });
    await Promise.resolve();

    await handler({
      match: ["cancel_1", "cancel", "1"],
      from: { id: 10 },
      answerCallbackQuery: jest.fn(),
    });
    await expect(resultPromise).resolves.toBe(-1);
    expect(mockSendTelegramMessage).toHaveBeenCalledTimes(1);
  });

  it("ignores clicks from another user (does not resolve, keeps pending)", async () => {
    const fakeBot = createFakeBot();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerConfirmActions(fakeBot as any);
    const handler = fakeBot.callbackQuery.mock.calls[0][1] as (ctx: unknown) => Promise<void>;

    const msg = createMsg();
    const chatConfig = createChat();
    const onConfirm = jest.fn(async () => 42);
    let resolved = false;
    const resultPromise = telegramConfirm({
      chatId: 1,
      msg,
      chatConfig,
      text: "Are you sure?",
      onConfirm,
      onCancel: async () => 0,
    }).then((res) => {
      resolved = true;
      return res;
    });
    await Promise.resolve();

    const answerCallbackQuery = jest.fn();
    await handler({
      match: ["confirm_1", "confirm", "1"],
      from: { id: 999 },
      answerCallbackQuery,
    });
    await Promise.resolve();

    expect(onConfirm).not.toHaveBeenCalled();
    expect(answerCallbackQuery).not.toHaveBeenCalled();
    expect(resolved).toBe(false);

    // The confirmation should still be pending: the rightful user can still confirm it.
    await handler({
      match: ["confirm_1", "confirm", "1"],
      from: { id: 10 },
      answerCallbackQuery: jest.fn(),
    });
    await expect(resultPromise).resolves.toBe(42);
  });

  it("answers 'Expired' for unknown confirmation id", async () => {
    const fakeBot = createFakeBot();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerConfirmActions(fakeBot as any);
    const handler = fakeBot.callbackQuery.mock.calls[0][1] as (ctx: unknown) => Promise<void>;
    const answerCallbackQuery = jest.fn();
    await handler({ match: ["confirm_99", "confirm", "99"], from: { id: 1 }, answerCallbackQuery });
    expect(answerCallbackQuery).toHaveBeenCalledWith("Expired");
  });

  it("skips sending when noSendTelegram is true but still resolves on click", async () => {
    const fakeBot = createFakeBot();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerConfirmActions(fakeBot as any);
    const handler = fakeBot.callbackQuery.mock.calls[0][1] as (ctx: unknown) => Promise<void>;

    const msg = createMsg();
    const chatConfig = createChat();
    const resultPromise = telegramConfirm({
      chatId: 1,
      msg,
      chatConfig,
      text: "Are you sure?",
      onConfirm: async () => 42,
      onCancel: async () => 0,
      noSendTelegram: true,
    });
    await Promise.resolve();
    expect(mockSendTelegramMessage).not.toHaveBeenCalled();

    await handler({
      match: ["confirm_1", "confirm", "1"],
      from: { id: 10 },
      answerCallbackQuery: jest.fn(),
    });
    await expect(resultPromise).resolves.toBe(42);
  });

  it("sends inline keyboard with confirm_<id>/cancel_<id> callback_data", async () => {
    const msg = createMsg();
    const chatConfig = createChat();
    void telegramConfirm({
      chatId: 1,
      msg,
      chatConfig,
      text: "Are you sure?",
      onConfirm: async () => 42,
      onCancel: async () => 0,
    });
    await Promise.resolve();

    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      1,
      "Are you sure?",
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Yes", callback_data: "confirm_1" },
              { text: "No", callback_data: "cancel_1" },
            ],
          ],
        },
      },
      undefined,
      chatConfig,
    );
  });
});
