import { jest, describe, it, beforeEach, expect } from "@jest/globals";
import type { Request, Response } from "express";

const mockUseConfig = jest.fn();
const mockValidateConfig = jest.fn();
const mockWatchConfigChanges = jest.fn();
const mockUseBot = jest.fn();
const mockInitCommands = jest.fn();
const mockWriteConfig = jest.fn();
const mockLog = jest.fn();
const mockUseMqtt = jest.fn();
const mockOnTextMessage = jest.fn();
const mockUseLastCtx = jest.fn();

jest.unstable_mockModule("langfuse", () => ({
  Langfuse: class {},
  LangfuseTraceClient: class {},
  observeOpenAI: jest.fn(),
}));

const expressApp = {
  use: jest.fn(),
  get: jest.fn(),
  post: jest.fn(),
  listen: jest.fn((_: number, cb: () => void) => cb()),
};
const mockExpress = jest.fn(() => expressApp);
mockExpress.json = jest.fn(
  () => (_req: Request, _res: Response, next: () => void) => next(),
);

jest.unstable_mockModule("../src/config.ts", () => ({
  __esModule: true,
  useConfig: () => mockUseConfig(),
  validateConfig: (...args: unknown[]) => mockValidateConfig(...args),
  writeConfig: (...args: unknown[]) => mockWriteConfig(...args),
  watchConfigChanges: (...args: unknown[]) => mockWatchConfigChanges(...args),
  readConfig: jest.fn(),
}));

jest.unstable_mockModule("../src/bot", () => ({
  __esModule: true,
  useBot: (...args: unknown[]) => mockUseBot(...args),
  getBots: () => ({}),
}));

jest.unstable_mockModule("../src/commands.ts", () => ({
  __esModule: true,
  initCommands: (...args: unknown[]) => mockInitCommands(...args),
}));

jest.unstable_mockModule("../src/helpers.ts", () => ({
  __esModule: true,
  log: (...args: unknown[]) => mockLog(...args),
  agentNameToId: jest.fn(),
  sendToHttp: jest.fn(),
}));

jest.unstable_mockModule("../src/mqtt.ts", () => ({
  __esModule: true,
  useMqtt: () => mockUseMqtt(),
  isMqttConnected: () => true,
  publishMqttProgress: jest.fn(),
}));

jest.unstable_mockModule("../src/handlers/onTextMessage.ts", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockOnTextMessage(...args),
}));

jest.unstable_mockModule("../src/helpers/lastCtx.ts", () => ({
  __esModule: true,
  useLastCtx: () => mockUseLastCtx(),
}));

jest.unstable_mockModule("express", () => ({
  __esModule: true,
  default: mockExpress,
}));

let index: typeof import("../src/index.ts");
let telegramPostHandler: any;
let telegramPostHandlerTest: any;

beforeEach(async () => {
  jest.resetModules();
  mockUseConfig.mockReset();
  mockValidateConfig.mockReset().mockReturnValue(true);
  mockWatchConfigChanges.mockReset();
  mockUseBot.mockReset().mockReturnValue({
    help: jest.fn(),
    on: jest.fn(),
    action: jest.fn(),
    launch: jest.fn().mockResolvedValue(undefined),
  });
  mockInitCommands.mockReset();
  mockWriteConfig.mockReset();
  mockLog.mockReset();
  mockUseMqtt.mockReset();
  mockOnTextMessage
    .mockReset()
    .mockImplementation(async (_ctx, _o, cb) => cb({ text: "ok" }));
  mockUseLastCtx.mockReset();
  mockExpress.mockClear();

  const config = {
    auth: { bot_token: "t" },
    bot_name: "main",
    http: { telegram_from_username: "user", port: 3000 },
    chats: [
      {
        id: 1,
        name: "c",
        bot_token: "b",
        bot_name: "b",
        completionParams: {},
        chatParams: {},
        toolParams: {},
      },
    ],
  };
  mockUseConfig.mockReturnValue(config);

  index = await import("../src/index.ts");
  telegramPostHandler = index.telegramPostHandler;
  telegramPostHandlerTest = index.telegramPostHandlerTest;
});

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    contentType: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

describe("telegramPostHandler", () => {
  it("rejects missing text", async () => {
    const res = createRes();
    await telegramPostHandler(
      { params: { chatId: "1" }, body: {} } as unknown as Request,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns error when chat not found", async () => {
    const res = createRes();
    mockUseConfig.mockReturnValueOnce({
      auth: {},
      bot_name: "m",
      http: { telegram_from_username: "u" },
      chats: [],
    });
    await telegramPostHandler(
      { params: { chatId: "99" }, body: { text: "hi" } } as unknown as Request,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("sends message when ok", async () => {
    const res = createRes();
    mockUseLastCtx.mockReturnValue({});
    await telegramPostHandler(
      { params: { chatId: "1" }, body: { text: "hi" } } as unknown as Request,
      res,
    );
    expect(res.end).toHaveBeenCalledWith("ok");
  });
});

describe("telegramPostHandlerTest", () => {
  it("sets default params", async () => {
    const req = { params: {}, body: {} } as unknown as Request;
    const res = createRes();
    mockUseLastCtx.mockReturnValue({});
    await telegramPostHandlerTest(req, res);
    expect(req.params.chatId).toBe("-4534736935");
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
