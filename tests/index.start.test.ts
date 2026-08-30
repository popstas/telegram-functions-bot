import { jest, describe, it, expect, beforeAll, beforeEach, afterEach } from "@jest/globals";
import { makeGrammyError } from "./testHelpers.ts";

const botInstance = {
  use: jest.fn(),
  command: jest.fn(),
  on: jest.fn(),
  catch: jest.fn(),
  callbackQuery: jest.fn(),
  botInfo: { username: "bot" },
};

const runnerHandle = {
  task: () => Promise.resolve(),
  stop: jest.fn(async () => {}),
  isRunning: () => true,
};
const mockRun = jest.fn(() => runnerHandle);
const mockBotReady = jest.fn(async () => {});
const mockSetRunnerHandle = jest.fn();

const mockUseConfig = jest.fn();
const mockValidateConfig = jest.fn();
const mockWatchConfigChanges = jest.fn();
const mockUseMqtt = jest.fn();
const mockShutdownMqtt = jest.fn();
const mockUseBot = jest.fn(() => botInstance);
const mockInitCommands = jest.fn();
const mockLog = jest.fn();
const mockInitTools = jest.fn();

jest.unstable_mockModule("../src/config.ts", () => ({
  __esModule: true,
  useConfig: () => mockUseConfig(),
  validateConfig: (...args: unknown[]) => mockValidateConfig(...args),
  watchConfigChanges: (...args: unknown[]) => mockWatchConfigChanges(...args),
  writeConfig: jest.fn(),
  readConfig: jest.fn(),
  generatePrivateChatConfig: jest.fn(),
  syncButtons: jest.fn(),
  updateChatInConfig: jest.fn(),
}));

jest.unstable_mockModule("../src/mqtt.ts", () => ({
  __esModule: true,
  useMqtt: () => mockUseMqtt(),
  isMqttConnected: jest.fn(),
  publishMqttProgress: jest.fn(),
  shutdownMqtt: (...args: unknown[]) => mockShutdownMqtt(...args),
}));

const expressApp = {
  use: jest.fn(),
  get: jest.fn(),
  post: jest.fn(),
  listen: jest.fn((_: number, cb: () => void) => cb()),
};
const mockExpress = jest.fn(() => expressApp);
mockExpress.json = jest.fn(() => (_req: unknown, _res: unknown, next: () => void) => next());

jest.unstable_mockModule("@grammyjs/runner", () => ({
  __esModule: true,
  run: (...args: unknown[]) => mockRun(...args),
  sequentialize: jest.fn(() => (_ctx: unknown, next: () => void) => next()),
}));

jest.unstable_mockModule("../src/bot.ts", () => ({
  __esModule: true,
  useBot: () => mockUseBot(),
  botReady: (...args: unknown[]) => mockBotReady(...args),
  getBots: () => ({ main: botInstance }),
  setRunnerHandle: (...args: unknown[]) => mockSetRunnerHandle(...args),
  getRunnerHandles: () => ({}),
}));

jest.unstable_mockModule("../src/commands.ts", () => ({
  __esModule: true,
  initCommands: (...args: unknown[]) => mockInitCommands(...args),
  handleAddChat: jest.fn(),
  registerCommandActions: jest.fn(),
}));

jest.unstable_mockModule("../src/helpers/useTools.ts", () => ({
  __esModule: true,
  initTools: (...args: unknown[]) => mockInitTools(...args),
  default: jest.fn(),
  useChatMcpTools: jest.fn().mockResolvedValue([]),
  cleanupChatMcpTools: jest.fn(),
  __testChatMcp: { getState: jest.fn(() => ({})), clearState: jest.fn() },
}));

jest.unstable_mockModule("../src/helpers.ts", () => ({
  __esModule: true,
  log: (...args: unknown[]) => mockLog(...args),
  agentNameToId: jest.fn(),
  sendToHttp: jest.fn(),
  ensureDirectoryExists: jest.fn(),
  safeFilename: jest.fn(),
  stringToId: jest.fn(),
}));

jest.unstable_mockModule("express", () => ({
  __esModule: true,
  default: mockExpress,
}));

let index: typeof import("../src/index.ts");

beforeAll(async () => {
  index = await import("../src/index.ts");
});

beforeEach(() => {
  index.__resetForTests?.();
  mockUseConfig.mockReset();
  mockValidateConfig.mockReset();
  mockWatchConfigChanges.mockReset();
  mockUseMqtt.mockReset();
  mockShutdownMqtt.mockReset();
  mockUseBot.mockReset();
  mockUseBot.mockImplementation(() => botInstance);
  mockInitCommands.mockReset();
  mockInitTools.mockReset();
  mockLog.mockReset();
  mockExpress.mockClear();
  mockExpress.json.mockClear();
  expressApp.use.mockReset();
  expressApp.get.mockReset();
  expressApp.post.mockReset();
  expressApp.listen.mockReset();
  expressApp.listen.mockImplementation((_: number, cb: () => void) => cb());
  botInstance.use.mockReset();
  botInstance.command.mockReset();
  botInstance.on.mockReset();
  botInstance.catch.mockReset();
  botInstance.callbackQuery.mockReset();
  mockRun.mockReset();
  mockRun.mockReturnValue(runnerHandle);
  runnerHandle.stop.mockReset();
  runnerHandle.stop.mockImplementation(async () => {});
  mockBotReady.mockReset();
  mockBotReady.mockImplementation(async () => {});
  mockSetRunnerHandle.mockReset();
});

afterEach(async () => {
  await index.stopBot();
  index.__resetForTests?.();
});

describe("start", () => {
  it("launches bots and http server", async () => {
    const config = {
      auth: { bot_token: "t" },
      bot_name: "main",
      http: { port: 3000 },
      chats: [
        {
          id: 1,
          name: "c",
          bot_token: "t2",
          bot_name: "b",
          completionParams: {},
          chatParams: {},
          toolParams: {},
        },
      ],
    };
    mockUseConfig.mockReturnValue(config);
    mockValidateConfig.mockReturnValue(true);

    expressApp.listen.mockClear();

    await index.start();

    expect(mockWatchConfigChanges).toHaveBeenCalled();
    expect(mockInitTools).toHaveBeenCalled();
    expect(mockUseBot).toHaveBeenCalledTimes(2);
    expect(mockRun).toHaveBeenCalledTimes(2);
    expect(mockSetRunnerHandle).toHaveBeenCalledTimes(2);
    expect(expressApp.listen).toHaveBeenCalled();
    expect(mockUseMqtt).toHaveBeenCalled();
  });

  it("exits when config invalid", async () => {
    mockUseConfig.mockReturnValue({ auth: {} });
    mockValidateConfig.mockReturnValue(false);
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await index.start();

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("restarts on error", async () => {
    const config = {
      auth: { bot_token: "t" },
      bot_name: "main",
      http: { port: 3000 },
      chats: [],
    };
    mockUseConfig.mockReturnValue(config);
    mockValidateConfig.mockReturnValue(true);
    expressApp.listen.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const setTimeoutSpy = jest
      .spyOn(global, "setTimeout")
      .mockImplementation(() => 0 as unknown as NodeJS.Timeout);

    await index.start();

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 10000);
    setTimeoutSpy.mockRestore();
  });
});

describe("launchBot", () => {
  it("logs invalid token when botReady rejects with 401", async () => {
    mockUseConfig.mockReturnValue({ chats: [] });
    mockBotReady.mockRejectedValueOnce(makeGrammyError(401, "Unauthorized"));
    mockInitCommands.mockReset();
    mockLog.mockReset();

    await index.launchBot("t", "b");
    expect(mockRun).not.toHaveBeenCalled();
    expect(mockLog).toHaveBeenCalledWith({
      msg: expect.stringContaining("Invalid bot token"),
      logLevel: "error",
    });
  });
});
