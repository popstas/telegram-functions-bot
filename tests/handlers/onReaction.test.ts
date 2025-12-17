import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Context } from "telegraf";
import type { ConfigChatType } from "../../src/types.ts";

const mockOnTextMessage = jest.fn();
const mockCheckAccessLevel = jest.fn();

jest.unstable_mockModule("../../src/handlers/onTextMessage.ts", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockOnTextMessage(...args),
}));

jest.unstable_mockModule("../../src/handlers/access.ts", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockCheckAccessLevel(...args),
}));

let onReaction: typeof import("../../src/handlers/onReaction.ts").default;

const baseChat: ConfigChatType = {
  name: "default",
  completionParams: {},
  chatParams: {},
  toolParams: {},
} as ConfigChatType;

function createReactionCtx(update: object): Context {
  return {
    update: { message_reaction: update },
    botInfo: { id: 1, is_bot: true, username: "bot", first_name: "bot" },
  } as unknown as Context;
}

beforeEach(async () => {
  jest.resetModules();
  mockOnTextMessage.mockReset();
  mockCheckAccessLevel.mockReset();
  onReaction = (await import("../../src/handlers/onReaction.ts")).default;
});

describe("onReaction", () => {
  it("forwards reaction as text", async () => {
    const ctx = createReactionCtx({
      chat: { id: 1, type: "private", first_name: "Alice" },
      message_id: 42,
      date: 123,
      user: { id: 2, is_bot: false, first_name: "User" },
      old_reaction: [],
      new_reaction: [{ type: "emoji", emoji: "❤️" }],
    });

    mockCheckAccessLevel.mockImplementation(async (reactionCtx: Context) => ({
      msg: reactionCtx.message,
      chat: baseChat,
    }));

    await onReaction(ctx);

    expect(mockOnTextMessage).toHaveBeenCalledTimes(1);
    const forwardedCtx = mockOnTextMessage.mock.calls[0][0] as Context;
    expect((forwardedCtx.message as { text: string }).text).toBe("❤️ (reaction)");
  });

  it("skips when reactions disabled", async () => {
    const ctx = createReactionCtx({
      chat: { id: 1, type: "private", first_name: "Alice" },
      message_id: 42,
      date: 123,
      user: { id: 2, is_bot: false, first_name: "User" },
      old_reaction: [],
      new_reaction: [{ type: "emoji", emoji: "❤️" }],
    });

    mockCheckAccessLevel.mockImplementation(async (reactionCtx: Context) => ({
      msg: reactionCtx.message,
      chat: { ...baseChat, chatParams: { answerReactions: false } },
    }));

    await onReaction(ctx);

    expect(mockOnTextMessage).not.toHaveBeenCalled();
  });
});
