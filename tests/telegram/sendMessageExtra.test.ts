import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { ConfigChatType } from "../../src/types.ts";

const mockSendMessage = jest.fn();
const mockSendRichMessage = jest.fn();
const mockDeleteMessage = jest.fn();
const mockUseBot = jest.fn(() => ({
  api: {
    sendMessage: mockSendMessage,
    sendRichMessage: mockSendRichMessage,
    deleteMessage: mockDeleteMessage,
  },
}));

jest.unstable_mockModule("../../src/bot.ts", () => ({
  useBot: (...args: unknown[]) => mockUseBot(...args),
}));

jest.unstable_mockModule("../../src/helpers.ts", () => ({
  __esModule: true,
  log: jest.fn(),
  safeFilename: jest.fn((v) => v),
  stringToId: jest.fn(),
}));

// mock splitBigMessage so we control number of parts
const mockSplit = jest.fn();
jest.unstable_mockModule("../../src/utils/text.ts", () => ({
  splitBigMessage: (...args: unknown[]) => mockSplit(...args),
}));

let sendTelegramMessage: typeof import("../../src/telegram/send.ts").sendTelegramMessage;
// Loaded dynamically after resetModules so its GrammyError shares the same module
// instance as the freshly-imported send.ts (otherwise `instanceof` fails).
let makeGrammyError: typeof import("../testHelpers.ts").makeGrammyError;

beforeEach(async () => {
  jest.resetModules();
  mockSendMessage.mockReset();
  mockSendRichMessage.mockReset();
  mockSendRichMessage.mockResolvedValue({ message_id: 10, chat: { id: 1 } });
  mockDeleteMessage.mockReset();
  mockSplit.mockReset();
  mockSplit.mockImplementation((t: string) => [t]);
  const mod = await import("../../src/telegram/send.ts");
  sendTelegramMessage = mod.sendTelegramMessage;
  ({ makeGrammyError } = await import("../testHelpers.ts"));
});

describe("sendTelegramMessage rich path", () => {
  const chatConfig: ConfigChatType = {
    name: "chat",
    completionParams: {},
    chatParams: {},
    toolParams: {},
    bot_token: "token",
  } as ConfigChatType;

  it("sends via sendRichMessage with raw markdown and passthrough options", async () => {
    const kb = { inline_keyboard: [] };
    await sendTelegramMessage(
      1,
      "# Title\n\nlong text",
      { reply_markup: kb, reply_to_message_id: 7 },
      undefined,
      chatConfig,
    );
    expect(mockSendRichMessage).toHaveBeenCalledWith(
      1,
      { markdown: "# Title\n\nlong text" },
      {
        reply_markup: kb,
        reply_parameters: { message_id: 7, allow_sending_without_reply: true },
      },
    );
    expect(mockSendMessage).not.toHaveBeenCalled(); // no splitting, no legacy call
  });

  it("drops reply_parameters for synthetic out-of-range reply_to_message_id", async () => {
    const kb = { inline_keyboard: [] };
    await sendTelegramMessage(
      1,
      "# Title\n\nlong text",
      { reply_markup: kb, reply_to_message_id: 1783224040440 },
      undefined,
      chatConfig,
    );
    expect(mockSendRichMessage).toHaveBeenCalledWith(
      1,
      { markdown: "# Title\n\nlong text" },
      { reply_markup: kb },
    );
    const [, , options] = mockSendRichMessage.mock.calls[0];
    expect(options).not.toHaveProperty("reply_parameters");
    expect(options).not.toHaveProperty("reply_to_message_id");
  });

  it("returns a message carrying .text on the rich path", async () => {
    const res = await sendTelegramMessage(1, "hello", {}, undefined, chatConfig);
    expect(res?.text).toBe("hello");
  });

  it("falls back to legacy MarkdownV2 send when sendRichMessage rejects", async () => {
    mockSendRichMessage.mockRejectedValueOnce(makeGrammyError(400, "media rights required"));
    await sendTelegramMessage(1, "hi *there*", {}, undefined, chatConfig);
    expect(mockSendMessage).toHaveBeenCalled(); // telegramified, split, MarkdownV2
  });

  it("uses only the legacy path for plainText sends", async () => {
    await sendTelegramMessage(
      1,
      "https://x.io/?a=%20b",
      { plainText: true },
      undefined,
      chatConfig,
    );
    expect(mockSendRichMessage).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalled();
  });

  it("returns undefined and stops when blocked by user (403) on rich path", async () => {
    mockSendRichMessage.mockRejectedValueOnce(makeGrammyError(403, "bot was blocked by the user"));
    const res = await sendTelegramMessage(1, "hi", {}, undefined, chatConfig);
    expect(res).toBeUndefined();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});

describe("sendTelegramMessage legacy fallback path", () => {
  const chatConfig: ConfigChatType = {
    name: "chat",
    completionParams: {},
    chatParams: {},
    toolParams: {},
    bot_token: "token",
  } as ConfigChatType;

  beforeEach(() => {
    // force legacy path for all cases in this block
    mockSendRichMessage.mockRejectedValue(makeGrammyError(400, "fallback"));
  });

  it("sanitizes HTML and sets parse_mode", async () => {
    mockSplit.mockImplementation((t) => [t]);
    await sendTelegramMessage(1, "<p>Hello&nbsp;world</p><br>Next", {}, undefined, chatConfig);
    expect(mockSendMessage).toHaveBeenCalledWith(
      1,
      "Hello world\n\nNext",
      expect.objectContaining({ parse_mode: "HTML" }),
    );
  });

  it("handles think tag", async () => {
    mockSplit.mockImplementation((t) => [t]);
    await sendTelegramMessage(1, "<think>foo</think> result", {}, undefined, chatConfig);
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    const texts = mockSendMessage.mock.calls.map((c) => c[1]);
    expect(texts.some((t) => t.includes("`think:`") && t.includes("foo"))).toBe(true);
    expect(texts.some((t) => t.includes("result"))).toBe(true);
  });

  it("splits long messages", async () => {
    mockSplit.mockReturnValue(["part1", "part2"]);
    await sendTelegramMessage(1, "long", {}, undefined, chatConfig);
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
  });
});
