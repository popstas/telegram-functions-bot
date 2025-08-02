import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Message } from "telegraf/types";
import type { ConfigChatType } from "../../src/types";

const mockSendTelegramMessage = jest.fn();
const actions: Record<string, (ctx: unknown) => Promise<void>> = {};

jest.unstable_mockModule("../../src/telegram/send.ts", () => ({
  __esModule: true,
  sendTelegramMessage: (...args: unknown[]) => mockSendTelegramMessage(...args),
}));

jest.unstable_mockModule("../../src/bot.ts", () => ({
  __esModule: true,
  useBot: () => ({
    action: (name: string, cb: (ctx: unknown) => Promise<void>) => {
      actions[name] = cb;
    },
  }),
}));

let telegram_confirm: typeof import("../../src/telegram/confirm.ts").telegram_confirm;

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

beforeEach(async () => {
  jest.resetModules();
  mockSendTelegramMessage.mockReset();
  mockSendTelegramMessage.mockResolvedValue(undefined);
  Object.keys(actions).forEach((k) => delete actions[k]);
  ({ telegram_confirm } = await import("../../src/telegram/confirm.ts"));
});

describe("telegram_confirm", () => {
  it("resolves with onConfirm on yes", async () => {
    const msg = createMsg();
    const chatConfig = createChat();
    const resultPromise = telegram_confirm(
      1,
      msg,
      chatConfig,
      "Are you sure?",
      async () => 42,
      async () => 0,
    );
    await Promise.resolve();
    expect(mockSendTelegramMessage).toHaveBeenCalled();
    const confirmName = Object.keys(actions).find((n) =>
      n.startsWith("confirm_"),
    )!;
    await actions[confirmName]({
      chat: { id: 1 },
      from: { id: 10 },
      answerCbQuery: jest.fn(),
    });
    await expect(resultPromise).resolves.toBe(42);
  });

  it("resolves with onCancel on no and notifies", async () => {
    const msg = createMsg();
    const chatConfig = createChat();
    const resultPromise = telegram_confirm(
      1,
      msg,
      chatConfig,
      "Are you sure?",
      async () => 1,
      async () => -1,
    );
    await Promise.resolve();
    const cancelName = Object.keys(actions).find((n) =>
      n.startsWith("cancel_"),
    )!;
    await actions[cancelName]({
      chat: { id: 1 },
      from: { id: 10 },
      answerCbQuery: jest.fn(),
    });
    await expect(resultPromise).resolves.toBe(-1);
    expect(mockSendTelegramMessage).toHaveBeenCalledTimes(2);
    expect(mockSendTelegramMessage.mock.calls[1][1]).toBe("Action canceled.");
  });
});
