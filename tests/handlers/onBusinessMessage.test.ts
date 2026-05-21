import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Context } from "telegraf";
import type { ConfigType } from "../../src/types.ts";

const mockUseConfig = jest.fn();
const mockOnTextMessage = jest.fn(() => Promise.resolve(undefined));
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

const businessCtx = (over: Record<string, unknown> = {}, update: Record<string, unknown> = {}) =>
  ({
    update: {
      business_message: {
        text: "hi",
        message_id: 7,
        chat: { id: 42, type: "private" },
        from: { username: "customer" },
        business_connection_id: "conn1",
      },
      ...update,
    },
    telegram: { callApi: jest.fn() },
    botInfo: { username: "bot" },
    ...over,
  }) as unknown as Context;

beforeEach(async () => {
  jest.resetModules();
  mockUseConfig.mockReset();
  mockOnTextMessage.mockReset();
  mockLog.mockReset();
  mockOnTextMessage.mockResolvedValue(undefined);
  mod = await import("../../src/handlers/onBusinessMessage.ts");
  ctxMod = await import("../../src/telegram/context.ts");
  mod.__resetBusinessConnections();
});

describe("onBusinessConnection", () => {
  it("caches the connection owner and reply permission", async () => {
    const ctx = {
      update: {
        business_connection: {
          id: "conn1",
          user: { username: "popstas" },
          can_reply: true,
          is_enabled: true,
        },
      },
    } as unknown as Context;

    await mod.onBusinessConnection(ctx);

    // Cached: a following message resolves the owner without an API call.
    const msgCtx = businessCtx();
    await mod.onBusinessMessage(msgCtx);
    expect((msgCtx.telegram as unknown as { callApi: jest.Mock }).callApi).not.toHaveBeenCalled();
    expect(mockOnTextMessage).toHaveBeenCalledTimes(1);
  });
});

describe("onBusinessMessage", () => {
  it("routes a text business message to onTextMessage with business fields", async () => {
    const connCtx = {
      update: {
        business_connection: {
          id: "conn1",
          user: { username: "popstas" },
          can_reply: true,
          is_enabled: true,
        },
      },
    } as unknown as Context;
    await mod.onBusinessConnection(connCtx);

    const ctx = businessCtx();
    await mod.onBusinessMessage(ctx);

    expect(mockOnTextMessage).toHaveBeenCalledTimes(1);
    const passed = mockOnTextMessage.mock.calls[0][0] as {
      businessConnectionId: string;
      businessOwnerUsername: string;
      message: { text: string };
    };
    expect(passed.businessConnectionId).toBe("conn1");
    expect(passed.businessOwnerUsername).toBe("popstas");
    expect(passed.message.text).toBe("hi");
  });

  it("resolves the owner via getBusinessConnection on cache miss", async () => {
    const callApi = jest
      .fn<(m: string, p: object) => Promise<unknown>>()
      .mockResolvedValue({ user: { username: "popstas" }, can_reply: true, is_enabled: true });
    const ctx = businessCtx({ telegram: { callApi } });

    await mod.onBusinessMessage(ctx);

    expect(callApi).toHaveBeenCalledWith("getBusinessConnection", {
      business_connection_id: "conn1",
    });
    expect(mockOnTextMessage).toHaveBeenCalledTimes(1);
  });

  it("does not route when the connection cannot reply", async () => {
    const connCtx = {
      update: {
        business_connection: {
          id: "conn1",
          user: { username: "popstas" },
          can_reply: false,
          is_enabled: true,
        },
      },
    } as unknown as Context;
    await mod.onBusinessConnection(connCtx);

    await mod.onBusinessMessage(businessCtx());
    expect(mockOnTextMessage).not.toHaveBeenCalled();
  });

  it("ignores non-text business messages", async () => {
    const ctx = businessCtx(
      {},
      {
        business_message: {
          message_id: 7,
          chat: { id: 42, type: "private" },
          from: { username: "customer" },
          business_connection_id: "conn1",
        },
      },
    );
    await mod.onBusinessMessage(ctx);
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
    } as unknown as Context;

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
    } as unknown as Context;

    const { chat } = ctxMod.getCtxChatMsg(ctx);
    expect(chat).toBeUndefined();
  });
});
