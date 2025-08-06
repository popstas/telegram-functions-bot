import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { ToolResponse } from "../../src/types.ts";

const mockReadConfig = jest.fn();

jest.unstable_mockModule("../../src/config.ts", () => ({
  readConfig: () => mockReadConfig(),
  updateChatInConfig: jest.fn(),
}));

let mod: typeof import("../../src/tools/get_next_offday.ts");

beforeEach(async () => {
  jest.resetModules();
  mockReadConfig.mockReset();
  mod = await import("../../src/tools/get_next_offday.ts");
});

describe("NextOffdayClient", () => {
  it("calculates next off day", async () => {
    const client = new mod.NextOffdayClient();
    const res = await client.get_next_offday({
      startOffDate: "2024-01-01",
      currentDate: "2024-01-03",
    });
    expect(res).toEqual({ content: "2024-01-05" } as ToolResponse);
  });

  it("options_string formats args", () => {
    const client = new mod.NextOffdayClient();
    const str = client.options_string(
      '{"startOffDate":"2024-01-01","currentDate":"2024-01-03"}',
    );
    expect(str).toBe("`get_next_offday(2024-01-01, 2024-01-03)`");
  });

  it("call returns instance", () => {
    expect(mod.call()).toBeInstanceOf(mod.NextOffdayClient);
  });
});

export {};
