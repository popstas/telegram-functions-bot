import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Message } from "telegraf/types";
import type { ConfigChatType } from "../../src/types";

const mockUseConfig = jest.fn();

jest.unstable_mockModule("../../src/config.ts", () => ({
  useConfig: () => mockUseConfig(),
}));

const { isAdminUser, buildButtonRows, getFullName, getTelegramForwardedUser } =
  await import("../../src/telegram/send.ts");

beforeEach(() => {
  jest.clearAllMocks();
  mockUseConfig.mockReturnValue({ adminUsers: ["admin"], privateUsers: [] });
});

describe("isAdminUser", () => {
  it("detects admin user", () => {
    const msg = {
      from: { username: "admin" },
    } as unknown as Message.TextMessage;
    expect(isAdminUser(msg)).toBe(true);
  });

  it("returns false for non admin", () => {
    const msg = {
      from: { username: "user" },
    } as unknown as Message.TextMessage;
    expect(isAdminUser(msg)).toBe(false);
  });

  it("returns false when username missing", () => {
    const msg = { from: {} } as unknown as Message.TextMessage;
    expect(isAdminUser(msg)).toBe(false);
  });
});

describe("buildButtonRows", () => {
  it("groups buttons by row", () => {
    const res = buildButtonRows([
      { name: "A", prompt: "", row: 1 },
      { name: "B", prompt: "", row: 2 },
      { name: "C", prompt: "", row: 1 },
    ]);
    expect(res).toEqual([[{ text: "A" }, { text: "C" }], [{ text: "B" }]]);
  });
});

describe("getFullName", () => {
  it("uses hidden user name", () => {
    const msg = {
      forward_origin: { type: "hidden_user", sender_user_name: "Anon" },
    } as unknown as Message.TextMessage;
    expect(getFullName(msg)).toBe("Anon");
  });

  it("uses forwarded user name", () => {
    const msg = {
      forward_origin: {
        type: "user",
        sender_user: { first_name: "John", last_name: "Doe" },
      },
    } as unknown as Message.TextMessage;
    expect(getFullName(msg)).toBe("John Doe");
  });

  it("uses from field", () => {
    const msg = {
      from: { first_name: "Jane", last_name: "Smith" },
    } as unknown as Message.TextMessage;
    expect(getFullName(msg)).toBe("Jane Smith");
  });
});

describe("getTelegramForwardedUser", () => {
  const baseChat = {
    name: "chat",
    completionParams: {},
    chatParams: {},
    toolParams: {},
  } as ConfigChatType;

  it("returns empty string when not forwarded", () => {
    const msg = { text: "hi" } as unknown as Message.TextMessage;
    expect(getTelegramForwardedUser(msg, baseChat)).toBe("");
  });

  it("formats forwarded user", () => {
    const msg = {
      forward_origin: {
        type: "user",
        sender_user: { first_name: "John", username: "john" },
      },
    } as unknown as Message.TextMessage;
    expect(getTelegramForwardedUser(msg, baseChat)).toBe(
      "John, Telegram: @john",
    );
  });

  it("returns empty when user is private", () => {
    const chat = { ...baseChat, privateUsers: ["john"] } as ConfigChatType;
    const msg = {
      forward_origin: {
        type: "user",
        sender_user: { first_name: "John", username: "john" },
      },
    } as unknown as Message.TextMessage;
    expect(getTelegramForwardedUser(msg, chat)).toBe("");
  });

  it("returns empty when user is admin", () => {
    const msg = {
      forward_origin: {
        type: "user",
        sender_user: { first_name: "Admin", username: "admin" },
      },
    } as unknown as Message.TextMessage;
    expect(getTelegramForwardedUser(msg, baseChat)).toBe("");
  });
});
