import { jest, describe, it, beforeEach, expect } from "@jest/globals";

const mockStop = jest.fn();
const mockGetMe = jest.fn(() => Promise.resolve({ id: 12345, username: "test_bot" }));
const TelegrafMock = jest.fn().mockImplementation(() => ({
  stop: mockStop,
  telegram: {
    getMe: mockGetMe,
  },
  botInfo: null,
}));
const mockUseConfig = jest.fn();

jest.unstable_mockModule("../src/config.ts", () => ({
  useConfig: () => mockUseConfig(),
  updateChatInConfig: jest.fn(),
}));

jest.unstable_mockModule("telegraf", () => ({
  Telegraf: TelegrafMock,
}));

jest.unstable_mockModule("https-proxy-agent", () => ({
  HttpsProxyAgent: jest.fn().mockImplementation((url: string) => ({ proxyUrl: url })),
}));

let useBot: typeof import("../src/bot.ts").useBot;
let HttpsProxyAgent: typeof import("https-proxy-agent").HttpsProxyAgent;

beforeEach(async () => {
  jest.resetModules();
  jest.clearAllMocks();
  ({ useBot } = await import("../src/bot.ts"));
  ({ HttpsProxyAgent } = await import("https-proxy-agent"));
});

describe("useBot", () => {
  it("creates bot with config token and caches instance", async () => {
    mockUseConfig.mockReturnValue({ auth: { bot_token: "token1" } });
    const onceSpy = jest.spyOn(process, "once").mockImplementation(() => process);

    const first = useBot();
    // Allow any pending promises to resolve
    await new Promise(process.nextTick);
    const second = useBot();

    expect(first).toBe(second);
    expect(TelegrafMock).toHaveBeenCalledTimes(1);
    expect(TelegrafMock).toHaveBeenCalledWith("token1", {});
    expect(onceSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
    expect(onceSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
    onceSpy.mockRestore();
  });

  it("uses provided token when passed", async () => {
    mockUseConfig.mockReturnValue({ auth: { bot_token: "token1" } });
    const bot = useBot("custom");
    // Allow any pending promises to resolve
    await new Promise(process.nextTick);
    const again = useBot("custom");
    expect(bot).toBe(again);
    expect(TelegrafMock).toHaveBeenCalledTimes(1);
    expect(TelegrafMock).toHaveBeenCalledWith("custom", {});
  });

  it("passes proxy agent to Telegraf when proxy_url is configured", async () => {
    mockUseConfig.mockReturnValue({
      auth: { bot_token: "token1", proxy_url: "http://proxy:8080" },
    });
    const onceSpy = jest.spyOn(process, "once").mockImplementation(() => process);

    useBot();
    await new Promise(process.nextTick);

    expect(HttpsProxyAgent).toHaveBeenCalledWith("http://proxy:8080");
    expect(TelegrafMock).toHaveBeenCalledWith("token1", {
      telegram: { agent: { proxyUrl: "http://proxy:8080" } },
    });
    onceSpy.mockRestore();
  });

  it("does not pass proxy agent when proxy_url is not set", async () => {
    mockUseConfig.mockReturnValue({ auth: { bot_token: "token1" } });
    const onceSpy = jest.spyOn(process, "once").mockImplementation(() => process);

    useBot();
    await new Promise(process.nextTick);

    expect(HttpsProxyAgent).not.toHaveBeenCalled();
    expect(TelegrafMock).toHaveBeenCalledWith("token1", {});
    onceSpy.mockRestore();
  });
});
