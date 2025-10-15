import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { ConfigChatType } from "../../src/types.ts";

const mockSendMessage = jest.fn();
const mockDeleteMessage = jest.fn();
const mockUseBot = jest.fn(() => ({
  telegram: { sendMessage: mockSendMessage, deleteMessage: mockDeleteMessage },
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

beforeEach(async () => {
  jest.resetModules();
  mockSendMessage.mockReset();
  mockDeleteMessage.mockReset();
  mockSplit.mockReset();
  const mod = await import("../../src/telegram/send.ts");
  sendTelegramMessage = mod.sendTelegramMessage;
});

describe("sendTelegramMessage", () => {
  const chatConfig: ConfigChatType = {
    name: "chat",
    completionParams: {},
    chatParams: {},
    toolParams: {},
    bot_token: "token",
  } as ConfigChatType;

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
