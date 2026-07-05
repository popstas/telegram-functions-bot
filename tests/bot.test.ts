import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const botInstances: FakeBot[] = [];
const failOnInit = new Set<string>();
class FakeBot {
  token: string;
  options: unknown;
  api = { config: { use: jest.fn() } };
  init: jest.Mock;
  stop = jest.fn(async () => {});
  constructor(token: string, options?: unknown) {
    this.token = token;
    this.options = options;
    this.init = failOnInit.has(token)
      ? jest.fn(async () => {
          throw new Error("init failed");
        })
      : jest.fn(async () => {});
    botInstances.push(this);
  }
}

jest.unstable_mockModule("grammy", () => ({ Bot: FakeBot }));
jest.unstable_mockModule("@grammyjs/auto-retry", () => ({
  autoRetry: jest.fn(() => "auto-retry-transformer"),
}));
jest.unstable_mockModule("../src/config.ts", () => ({
  useConfig: jest.fn(() => ({ auth: { bot_token: "tok-1", proxy_url: "" } })),
  readConfig: jest.fn(),
}));

const { useBot, botReady, getBots, setRunnerHandle, getRunnerHandles } = await import("../src/bot.ts");
const { useConfig } = await import("../src/config.ts");

describe("useBot (grammy)", () => {
  beforeEach(() => {
    botInstances.length = 0;
    (useConfig as jest.Mock).mockReturnValue({ auth: { bot_token: "tok-1", proxy_url: "" } });
  });

  it("creates one Bot per token and caches it", () => {
    const a = useBot("t1");
    expect(useBot("t1")).toBe(a);
    expect(useBot("t2")).not.toBe(a);
  });

  it("installs the auto-retry transformer and starts init", async () => {
    useBot("t3");
    const inst = botInstances.find((b) => b.token === "t3")!;
    expect(inst.api.config.use).toHaveBeenCalledWith("auto-retry-transformer");
    expect(inst.init).toHaveBeenCalled();
    await expect(botReady("t3")).resolves.toBeUndefined();
  });

  it("passes proxy agent via client.baseFetchConfig when proxy_url set", () => {
    (useConfig as jest.Mock).mockReturnValue({ auth: { bot_token: "tok-p", proxy_url: "http://proxy:3128" } });
    useBot("tok-proxy");
    const inst = botInstances.find((b) => b.token === "tok-proxy")!;
    const opts = inst.options as { client: { baseFetchConfig: { agent: unknown; compress: boolean } } };
    expect(opts.client.baseFetchConfig.agent).toBeDefined();
    expect(opts.client.baseFetchConfig.compress).toBe(true);
  });

  it("stores and returns runner handles", () => {
    const handle = { isRunning: () => true } as never;
    setRunnerHandle("t1", handle);
    expect(getRunnerHandles()["t1"]).toBe(handle);
  });

  it("getBots exposes the registry", () => {
    useBot("t9");
    expect(Object.keys(getBots())).toContain("t9");
  });

  it("uses config token and caches instance when no token is passed", () => {
    (useConfig as jest.Mock).mockReturnValue({ auth: { bot_token: "default-tok", proxy_url: "" } });
    const first = useBot();
    const second = useBot();
    expect(first).toBe(second);
    const matching = botInstances.filter((b) => b.token === "default-tok");
    expect(matching).toHaveLength(1);
  });

  it("does not pass client options when proxy_url is not set", () => {
    useBot("tok-noproxy");
    const inst = botInstances.find((b) => b.token === "tok-noproxy")!;
    expect(inst.options).toBeUndefined();
  });

  it("registers SIGINT and SIGTERM handlers that best-effort stop the bot", () => {
    const onceSpy = jest.spyOn(process, "once").mockImplementation(() => process);

    useBot("tok-sig");

    expect(onceSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
    expect(onceSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));

    const inst = botInstances.find((b) => b.token === "tok-sig")!;
    const sigintHandler = onceSpy.mock.calls.find((call) => call[0] === "SIGINT")![1] as () => void;
    expect(() => sigintHandler()).not.toThrow();
    expect(inst.stop).toHaveBeenCalled();

    onceSpy.mockRestore();
  });

  it("cleans up registries on init failure and allows a fresh retry", async () => {
    failOnInit.add("tok-fail");
    useBot("tok-fail");
    const failedCount = botInstances.filter((b) => b.token === "tok-fail").length;
    expect(failedCount).toBe(1);

    await expect(botReady("tok-fail")).rejects.toThrow("init failed");

    expect(getBots()["tok-fail"]).toBeUndefined();

    failOnInit.delete("tok-fail");
    const retried = useBot("tok-fail");
    const matching = botInstances.filter((b) => b.token === "tok-fail");
    expect(matching).toHaveLength(2);
    expect(retried).toBe(matching[1]);
    await expect(botReady("tok-fail")).resolves.toBeUndefined();
  });
});
