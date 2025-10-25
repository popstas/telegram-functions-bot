import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import type { ConfigChatType, ThreadStateType } from "../../src/types.ts";

let mod: typeof import("../../src/tools/delay.ts");

beforeEach(async () => {
  jest.resetModules();
  jest.useFakeTimers();
  mod = await import("../../src/tools/delay.ts");
});

afterEach(() => {
  jest.useRealTimers();
});

describe("DelayClient", () => {
  const cfg = {} as ConfigChatType;
  const thread = { id: 1 } as ThreadStateType;

  it("delays for the specified number of seconds", async () => {
    const spy = jest.spyOn(global, "setTimeout");
    const client = new mod.DelayClient(cfg, thread);
    const promise = client.delay({ seconds: 2 });

    expect(spy).toHaveBeenCalledWith(expect.any(Function), 2000);

    jest.advanceTimersByTime(2000);
    await expect(promise).resolves.toEqual({ content: "Waited 2 seconds." });

    spy.mockRestore();
  });

  it("handles zero seconds without waiting", async () => {
    const spy = jest.spyOn(global, "setTimeout");
    const client = new mod.DelayClient(cfg, thread);
    const result = await client.delay({ seconds: 0 });

    expect(spy).not.toHaveBeenCalled();
    expect(result).toEqual({ content: "Waited 0 seconds." });

    spy.mockRestore();
  });

  it("formats options string", () => {
    const client = new mod.DelayClient(cfg, thread);
    expect(client.options_string('{"seconds":2}')).toBe("**Delay:** wait 2 seconds");
  });

  it("call returns DelayClient instance", () => {
    const client = mod.call(cfg, thread);
    expect(client).toBeInstanceOf(mod.DelayClient);
  });
});
