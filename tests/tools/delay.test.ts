import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { ConfigChatType, ThreadStateType } from "../../src/types.ts";

const mockLog = jest.fn();

jest.unstable_mockModule("../../src/helpers.ts", () => ({
  __esModule: true,
  log: (...args: unknown[]) => mockLog(...args),
  stringToId: jest.fn(),
}));

let mod: typeof import("../../src/tools/delay.ts");

beforeEach(async () => {
  jest.resetModules();
  mockLog.mockReset();
  mod = await import("../../src/tools/delay.ts");
});

describe("DelayClient", () => {
  const cfg = {} as ConfigChatType;
  const thread = { id: 2 } as ThreadStateType;

  it("delays for default 5 seconds and returns datetime", async () => {
    const client = new mod.DelayClient(cfg, thread);
    const startTime = Date.now();

    const res = await client.delay({ reason: "Testing delay" });

    const endTime = Date.now();
    const elapsed = endTime - startTime;

    // Should have waited approximately 5 seconds (with some tolerance)
    expect(elapsed).toBeGreaterThanOrEqual(4900);
    expect(elapsed).toBeLessThan(6000);

    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining("Delaying for 5 seconds"),
        logLevel: "info",
      }),
    );

    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining("Delay completed"),
        logLevel: "info",
      }),
    );

    expect(res.content).toContain("Waited 5 seconds");
    expect(res.content).toContain("Current datetime:");
  }, 10000);

  it("delays for custom seconds", async () => {
    const client = new mod.DelayClient(cfg, thread);
    const startTime = Date.now();

    const res = await client.delay({ seconds: 2, reason: "Custom wait" });

    const endTime = Date.now();
    const elapsed = endTime - startTime;

    // Should have waited approximately 2 seconds
    expect(elapsed).toBeGreaterThanOrEqual(1900);
    expect(elapsed).toBeLessThan(3000);

    expect(res.content).toContain("Waited 2 seconds");
  });

  it("enforces maximum delay of 85 seconds", async () => {
    const client = new mod.DelayClient(cfg, thread);
    const startTime = Date.now();

    // Try to delay for 100 seconds, should be capped at 85
    const res = await client.delay({ seconds: 100, reason: "Too long" });

    const endTime = Date.now();
    const elapsed = endTime - startTime;

    // Should have waited approximately 85 seconds
    expect(elapsed).toBeGreaterThanOrEqual(84000);
    expect(elapsed).toBeLessThan(86000);

    expect(res.content).toContain("Waited 85 seconds");
  }, 90000);

  it("enforces minimum delay of 1 second", async () => {
    const client = new mod.DelayClient(cfg, thread);
    const startTime = Date.now();

    // Try to delay for 0 seconds, should be at least 1
    const res = await client.delay({ seconds: 0, reason: "Too short" });

    const endTime = Date.now();
    const elapsed = endTime - startTime;

    // Should have waited approximately 1 second
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(elapsed).toBeLessThan(2000);

    expect(res.content).toContain("Waited 1 seconds");
  });

  it("logs reason for delay", async () => {
    const client = new mod.DelayClient(cfg, thread);

    await client.delay({ seconds: 1, reason: "Because I said so" });

    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining("Because I said so"),
      }),
    );
  });

  it("returns ISO datetime format", async () => {
    const client = new mod.DelayClient(cfg, thread);

    const res = await client.delay({ seconds: 1, reason: "Check format" });

    // ISO format should contain T and Z
    expect(res.content).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("options_string constant", () => {
    const client = new mod.DelayClient(cfg, thread);
    expect(client.options_string()).toBe(
      "`Wait for specified seconds and return current datetime`",
    );
  });

  it("call returns instance", () => {
    const client = mod.call(cfg, thread);
    expect(client).toBeInstanceOf(mod.DelayClient);
  });
});
