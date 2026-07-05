import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { BotContext } from "../../src/telegram/botContext.ts";
import type { ConfigType } from "../../src/types.ts";

const mockUseConfig = jest.fn();
const mockOnTextMessage = jest.fn(() => Promise.resolve(undefined));
const mockNoteSecretaryHumanReply = jest.fn();
const mockLog = jest.fn();

jest.unstable_mockModule("../../src/config.ts", () => ({
  __esModule: true,
  useConfig: (...args: unknown[]) => mockUseConfig(...args),
}));

jest.unstable_mockModule("../../src/helpers.ts", () => ({
  __esModule: true,
  log: (...args: unknown[]) => mockLog(...args),
}));

jest.unstable_mockModule("../../src/handlers/onTextMessage.ts", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockOnTextMessage(...args),
  noteSecretaryHumanReply: (...args: unknown[]) => mockNoteSecretaryHumanReply(...args),
}));

let mod: typeof import("../../src/handlers/onBusinessMessage.ts");
let ctxMod: typeof import("../../src/telegram/context.ts");

const baseConfig = (): ConfigType =>
  ({
    bot_name: "bot",
    chats: [
      { name: "default", systemMessage: "d", completionParams: {}, chatParams: {}, toolParams: {} },
      {
        name: "Private popstas",
        username: "popstas",
        completionParams: {},
        chatParams: { secretary: { firstAnswerDelay: 15 }, streaming: true },
        toolParams: {},
      },
    ],
  }) as unknown as ConfigType;

// Default business_message fixture. grammY exposes it via the native
// ctx.businessMessage getter, so the mock ctx sets it as a plain top-level field
// (mirroring what the real getter would return) rather than nesting it under update.
const defaultBusinessMessage = () => ({
  text: "hi",
  message_id: 7,
  chat: { id: 42, type: "private" },
  from: { username: "customer" },
  business_connection_id: "conn1",
});

const businessCtx = (
  over: Record<string, unknown> = {},
  messageOverride?: Record<string, unknown>,
) =>
  ({
    businessMessage: messageOverride ?? defaultBusinessMessage(),
    api: { getBusinessConnection: jest.fn() },
    me: { username: "bot" },
    ...over,
  }) as unknown as BotContext;

beforeEach(async () => {
  jest.resetModules();
  mockUseConfig.mockReset();
  mockOnTextMessage.mockReset();
  mockNoteSecretaryHumanReply.mockReset();
  mockLog.mockReset();
  mockOnTextMessage.mockResolvedValue(undefined);
  mod = await import("../../src/handlers/onBusinessMessage.ts");
  ctxMod = await import("../../src/telegram/context.ts");
  mod.__resetBusinessConnections();
});

describe("onBusinessConnection", () => {
  it("caches the connection owner and reply permission", async () => {
    const ctx = {
      businessConnection: {
        id: "conn1",
        user: { username: "popstas" },
        rights: { can_reply: true },
        is_enabled: true,
      },
    } as unknown as BotContext;

    await mod.onBusinessConnection(ctx);

    // Cached: a following message resolves the owner without an API call.
    const msgCtx = businessCtx();
    await mod.onBusinessMessage(msgCtx);
    expect(
      (msgCtx.api as unknown as { getBusinessConnection: jest.Mock }).getBusinessConnection,
    ).not.toHaveBeenCalled();
    expect(mockOnTextMessage).toHaveBeenCalledTimes(1);
  });
});

describe("onBusinessMessage", () => {
  it("routes a text business message to onTextMessage with business fields", async () => {
    const connCtx = {
      businessConnection: {
        id: "conn1",
        user: { username: "popstas" },
        rights: { can_reply: true },
        is_enabled: true,
      },
    } as unknown as BotContext;
    await mod.onBusinessConnection(connCtx);

    const ctx = businessCtx();
    await mod.onBusinessMessage(ctx);

    expect(mockOnTextMessage).toHaveBeenCalledTimes(1);
    const passed = mockOnTextMessage.mock.calls[0][0] as {
      businessConnectionId?: string;
      businessOwnerUsername: string;
      message: { text: string };
    };
    // businessConnectionId is derived natively by grammY from the message, not
    // set as an explicit flavor prop (setting it directly would collide with
    // grammY's own businessConnectionId getter).
    expect(passed.businessConnectionId).toBe("conn1");
    expect(passed.businessOwnerUsername).toBe("popstas");
    expect(passed.message.text).toBe("hi");
  });

  it("resolves the owner via getBusinessConnection on cache miss", async () => {
    const getBusinessConnection = jest.fn<(id: string) => Promise<unknown>>().mockResolvedValue({
      user: { username: "popstas" },
      rights: { can_reply: true },
      is_enabled: true,
    });
    const ctx = businessCtx({ api: { getBusinessConnection } });

    await mod.onBusinessMessage(ctx);

    expect(getBusinessConnection).toHaveBeenCalledWith("conn1");
    expect(mockOnTextMessage).toHaveBeenCalledTimes(1);
  });

  it("does not route when the connection cannot reply", async () => {
    const connCtx = {
      businessConnection: {
        id: "conn1",
        user: { username: "popstas" },
        rights: {},
        is_enabled: true,
      },
    } as unknown as BotContext;
    await mod.onBusinessConnection(connCtx);

    await mod.onBusinessMessage(businessCtx());
    expect(mockOnTextMessage).not.toHaveBeenCalled();
  });

  it("ignores non-text business messages", async () => {
    const ctx = businessCtx(
      {},
      {
        message_id: 7,
        chat: { id: 42, type: "private" },
        from: { username: "customer" },
        business_connection_id: "conn1",
      },
    );
    await mod.onBusinessMessage(ctx);
    expect(mockOnTextMessage).not.toHaveBeenCalled();
  });

  it("pauses auto-answer when the owner replies manually (matched by id)", async () => {
    const connCtx = {
      businessConnection: {
        id: "conn1",
        user: { id: 100, username: "popstas" },
        rights: { can_reply: true },
        is_enabled: true,
      },
    } as unknown as BotContext;
    await mod.onBusinessConnection(connCtx);

    // Message authored by the owner (from.id === connection owner id).
    const ctx = businessCtx(
      {},
      {
        text: "I'll take it from here",
        message_id: 9,
        chat: { id: 42, type: "private" },
        from: { id: 100, username: "popstas" },
        business_connection_id: "conn1",
      },
    );
    await mod.onBusinessMessage(ctx);

    expect(mockNoteSecretaryHumanReply).toHaveBeenCalledWith(42);
    expect(mockOnTextMessage).not.toHaveBeenCalled();
  });

  it("ignores the bot's own sent messages (sender_business_bot)", async () => {
    const connCtx = {
      businessConnection: {
        id: "conn1",
        user: { id: 100, username: "popstas" },
        rights: { can_reply: true },
        is_enabled: true,
      },
    } as unknown as BotContext;
    await mod.onBusinessConnection(connCtx);

    const ctx = businessCtx(
      {},
      {
        text: "auto reply",
        message_id: 9,
        chat: { id: 42, type: "private" },
        from: { id: 100, username: "popstas" },
        sender_business_bot: { id: 555, is_bot: true },
        business_connection_id: "conn1",
      },
    );
    await mod.onBusinessMessage(ctx);

    expect(mockNoteSecretaryHumanReply).not.toHaveBeenCalled();
    expect(mockOnTextMessage).not.toHaveBeenCalled();
  });
});

describe("getChatConfig business routing", () => {
  it("routes by owner username and disables streaming for the turn", () => {
    mockUseConfig.mockReturnValue(baseConfig());
    const ctx = {
      update: {
        message: { text: "hi", chat: { id: 42, type: "private" }, from: { username: "customer" } },
      },
      businessOwnerUsername: "popstas",
    } as unknown as BotContext;

    const { chat } = ctxMod.getCtxChatMsg(ctx);
    expect(chat?.name).toBe("Private popstas");
    expect(chat?.chatParams?.streaming).toBe(false);
    expect(chat?.chatParams?.secretary?.firstAnswerDelay).toBe(15);
  });

  it("returns undefined when no chat matches the owner", () => {
    mockUseConfig.mockReturnValue(baseConfig());
    const ctx = {
      update: {
        message: { text: "hi", chat: { id: 42, type: "private" }, from: { username: "customer" } },
      },
      businessOwnerUsername: "nobody",
    } as unknown as BotContext;

    const { chat } = ctxMod.getCtxChatMsg(ctx);
    expect(chat).toBeUndefined();
  });
});
