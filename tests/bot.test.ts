import { jest, describe, it, beforeEach, expect } from "@jest/globals";

const mockStop = jest.fn();
const TelegrafMock = jest.fn().mockImplementation(() => ({ stop: mockStop }));
const mockUseConfig = jest.fn();

jest.unstable_mockModule("../src/config.ts", () => ({
  useConfig: () => mockUseConfig(),
}));

jest.unstable_mockModule("telegraf", () => ({
  Telegraf: TelegrafMock,
}));

let useBot: typeof import("../src/bot.ts").useBot;

beforeEach(async () => {
  jest.resetModules();
  jest.clearAllMocks();
  ({ useBot } = await import("../src/bot.ts"));
});

describe("useBot", () => {
  it("creates bot with config token and caches instance", () => {
    mockUseConfig.mockReturnValue({ auth: { bot_token: "token1" } });
    const onceSpy = jest
      .spyOn(process, "once")
      .mockImplementation(() => process);

    const first = useBot();
    const second = useBot();

    expect(first).toBe(second);
    expect(TelegrafMock).toHaveBeenCalledTimes(1);
    expect(TelegrafMock).toHaveBeenCalledWith("token1");
    expect(onceSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
    expect(onceSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
    onceSpy.mockRestore();
  });

  it("uses provided token when passed", () => {
    mockUseConfig.mockReturnValue({ auth: { bot_token: "token1" } });
    const bot = useBot("custom");
    const again = useBot("custom");
    expect(bot).toBe(again);
    expect(TelegrafMock).toHaveBeenCalledTimes(1);
    expect(TelegrafMock).toHaveBeenCalledWith("custom");
  });
});
