import { jest, describe, it, expect, beforeAll, beforeEach, afterEach } from "@jest/globals";

const botInstance = {
  help: jest.fn(),
  on: jest.fn(),
  action: jest.fn(),
  catch: jest.fn(),
  launch: jest.fn().mockImplementation((_config, onLaunch) => {
    onLaunch?.();
    return Promise.resolve();
  }),
  botInfo: { username: "bot" },
};

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

jest.unstable_mockModule("../src/bot.ts", () => ({
  __esModule: true,
  useBot: () => mockUseBot(),
  getBots: () => ({ main: botInstance }),
}));

jest.unstable_mockModule("../src/commands.ts", () => ({
  __esModule: true,
  initCommands: (...args: unknown[]) => mockInitCommands(...args),
  handleAddChat: jest.fn(),
}));

jest.unstable_mockModule("../src/helpers/useTools.ts", () => ({
  __esModule: true,
  initTools: (...args: unknown[]) => mockInitTools(...args),
  default: jest.fn(),
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
  botInstance.help.mockReset();
  botInstance.on.mockReset();
  botInstance.action.mockReset();
  botInstance.catch.mockReset();
  botInstance.launch.mockReset();
  botInstance.launch.mockImplementation((_config, onLaunch) => {
    onLaunch?.();
    return Promise.resolve();
  });
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
  it("logs invalid token", async () => {
    mockUseConfig.mockReturnValue({ chats: [] });
    const err = { response: { statusCode: 401 } };
    mockUseBot.mockImplementationOnce(() => {
      throw err;
    });
    mockInitCommands.mockReset();
    mockLog.mockReset();

    jest.resetModules();
    index = await import("../src/index.ts");

    await index.launchBot("t", "b");
    expect(mockLog).toHaveBeenCalledWith({
      msg: expect.stringContaining("Invalid bot token"),
      logLevel: "error",
    });
  });
});
