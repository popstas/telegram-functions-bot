import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { ToolResponse } from "../../src/types.ts";

const mockExec = jest.fn();

jest.unstable_mockModule("child_process", () => ({
  exec: (...args: unknown[]) => mockExec(...args),
}));

let mod: typeof import("../../src/tools/powershell.ts");

beforeEach(async () => {
  jest.resetModules();
  mockExec.mockReset();
  mod = await import("../../src/tools/powershell.ts");
});

describe("PowershellCommandClient", () => {
  it("executes command and returns output", async () => {
    mockExec.mockImplementation(
      (cmd: string, cb: (e: Error | null, out: string, err: string) => void) =>
        cb(null, "ok", ""),
    );
    const client = new mod.PowershellCommandClient();
    const res = await client.powershell({ command: "Get" });
    expect(mockExec).toHaveBeenCalledWith(
      'powershell -Command "Get"',
      expect.any(Function),
    );
    expect(res).toEqual({ content: "```\nok\n```" } as ToolResponse);
  });

  it("returns exit code on error", async () => {
    mockExec.mockImplementation(
      (
        cmd: string,
        cb: (
          e: (Error & { code?: number }) | null,
          out: string,
          err: string,
        ) => void,
      ) => {
        const err: Error & { code?: number } = new Error("fail");
        err.code = 1;
        cb(err, "", "");
      },
    );
    const client = new mod.PowershellCommandClient();
    const res = await client.powershell({ command: "Fail" });
    expect(res).toEqual({ content: "Exit code: 1" } as ToolResponse);
  });

  it("returns exit code 0 when no output", async () => {
    mockExec.mockImplementation(
      (cmd: string, cb: (e: Error | null, out: string, err: string) => void) =>
        cb(null, "", ""),
    );
    const client = new mod.PowershellCommandClient();
    const res = await client.powershell({ command: "None" });
    expect(res).toEqual({ content: "Exit code: 0" } as ToolResponse);
  });

  it("rejects on stderr", async () => {
    mockExec.mockImplementation(
      (cmd: string, cb: (e: Error | null, out: string, err: string) => void) =>
        cb(null, "", "err"),
    );
    const client = new mod.PowershellCommandClient();
    await expect(client.powershell({ command: "Bad" })).rejects.toBe("err");
  });

  it("options_string formats command", () => {
    const client = new mod.PowershellCommandClient();
    const formatted = client.options_string('{"command":"ls"}');
    expect(formatted).toBe("`Powershell:`\n```powershell\nls\n```");
  });

  it("call returns instance", () => {
    expect(mod.call()).toBeInstanceOf(mod.PowershellCommandClient);
  });
});

export {};
