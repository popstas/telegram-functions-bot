import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { ConfigChatType, ThreadStateType } from "../../src/types";

const mockForgetHistory = jest.fn();
const mockLog = jest.fn();

jest.unstable_mockModule("../../src/helpers/history.ts", () => ({
  forgetHistory: (...args: unknown[]) => mockForgetHistory(...args),
}));

jest.unstable_mockModule("../../src/helpers.ts", () => ({
  log: (...args: unknown[]) => mockLog(...args),
}));

let mod: typeof import("../../src/tools/forget.ts");

beforeEach(async () => {
  jest.resetModules();
  mockForgetHistory.mockReset();
  mockLog.mockReset();
  mod = await import("../../src/tools/forget.ts");
});

describe("ForgetClient", () => {
  const cfg = {} as ConfigChatType;
  const thread = { id: 2 } as ThreadStateType;

  it("forgets history and logs", async () => {
    const client = new mod.ForgetClient(cfg, thread);
    const res = await client.forget({});
    expect(mockForgetHistory).toHaveBeenCalledWith(2);
    expect(mockLog).toHaveBeenCalled();
    expect(res.content).toBe("Forgot history");
  });

  it("uses custom message", async () => {
    const client = new mod.ForgetClient(cfg, thread);
    const res = await client.forget({ message: "Bye" });
    expect(res.content).toBe("Bye");
  });

  it("handles errors", async () => {
    mockForgetHistory.mockImplementation(() => {
      throw new Error("boom");
    });
    const client = new mod.ForgetClient(cfg, thread);
    const res = await client.forget({});
    expect(res.content).toContain("boom");
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({ logLevel: "error" })
    );
  });

  it("options_string constant", () => {
    const client = new mod.ForgetClient(cfg, thread);
    expect(client.options_string()).toBe("`Clear conversation history`");
  });

  it("call returns instance", () => {
    const client = mod.call(cfg, thread);
    expect(client).toBeInstanceOf(mod.ForgetClient);
  });
});
