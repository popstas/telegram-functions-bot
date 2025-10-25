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
    const promise = client.delay({ seconds: 2, reason: "Allow downstream API cooldown" });

    expect(spy).toHaveBeenCalledWith(expect.any(Function), 2000);

    jest.advanceTimersByTime(2000);
    await expect(promise).resolves.toEqual({
      content: "Waited 2 seconds. Reason: Allow downstream API cooldown",
    });

    spy.mockRestore();
  });

  it("handles zero seconds without waiting", async () => {
    const spy = jest.spyOn(global, "setTimeout");
    const client = new mod.DelayClient(cfg, thread);
    const result = await client.delay({ seconds: 0, reason: "Rate limit already reset" });

    expect(spy).not.toHaveBeenCalled();
    expect(result).toEqual({
      content: "Waited 0 seconds. Reason: Rate limit already reset",
    });

    spy.mockRestore();
  });

  it("uses the default number of seconds when omitted", async () => {
    const spy = jest.spyOn(global, "setTimeout");
    const client = new mod.DelayClient(cfg, thread);
    const promise = client.delay({ reason: "Allow UI to update" });

    expect(spy).toHaveBeenCalledWith(expect.any(Function), 5000);

    jest.advanceTimersByTime(5000);
    await expect(promise).resolves.toEqual({
      content: "Waited 5 seconds. Reason: Allow UI to update",
    });

    spy.mockRestore();
  });

  it("formats options string", () => {
    const client = new mod.DelayClient(cfg, thread);
    expect(client.options_string('{"seconds":2,"reason":"Retry after limit"}')).toBe(
      "**Delay:** wait 2 seconds — Retry after limit",
    );
  });

  it("falls back to the default seconds in options string", () => {
    const client = new mod.DelayClient(cfg, thread);
    expect(client.options_string('{"reason":"Awaiting dependency"}')).toBe(
      "**Delay:** wait 5 seconds — Awaiting dependency",
    );
  });

  it("call returns DelayClient instance", () => {
    const client = mod.call(cfg, thread);
    expect(client).toBeInstanceOf(mod.DelayClient);
  });
});
