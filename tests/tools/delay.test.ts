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

  it("delays for 1 second and returns datetime", async () => {
    const client = new mod.DelayClient(cfg, thread);
    const startTime = Date.now();

    const res = await client.delay({ seconds: 1, reason: "Testing delay" });

    const endTime = Date.now();
    const elapsed = endTime - startTime;

    // Should have waited approximately 1 second (with some tolerance)
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(elapsed).toBeLessThan(2000);

    expect(res.content).toContain("Waited 1 seconds");
    expect(res.content).toContain("Current datetime:");
    // ISO format should contain T
    expect(res.content).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

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
});
