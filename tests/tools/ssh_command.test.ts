import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { ConfigChatType } from "../../src/types.ts";

const mockExec = jest.fn();
const mockFileSync = jest.fn();
const mockWriteFileSync = jest.fn();

jest.unstable_mockModule("child_process", () => ({
  exec: (...args: unknown[]) => mockExec(...args),
}));

jest.unstable_mockModule("tmp", () => ({
  fileSync: (...args: unknown[]) => mockFileSync(...args),
}));
jest.unstable_mockModule("fs", () => {
  const real = jest.requireActual("fs");
  return {
    __esModule: true,
    ...real,
    default: {
      ...real,
      writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
    },
    writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  };
});
let mod: typeof import("../../src/tools/ssh_command.ts");

beforeEach(async () => {
  jest.resetModules();
  mockExec.mockReset();
  mockFileSync.mockReset();
  mockWriteFileSync.mockReset();
  mod = await import("../../src/tools/ssh_command.ts");
});

describe("SshCommandClient", () => {
  const cfg: ConfigChatType = {
    name: "chat",
    agent_name: "agent",
    completionParams: {},
    chatParams: {},
    toolParams: {
      ssh_command: { user: "u", host: "h", strictHostKeyChecking: true },
    },
  } as ConfigChatType;

  it("runs command via ssh", async () => {
    mockFileSync.mockReturnValue({
      name: "/tmp/tmp.sh",
      removeCallback: jest.fn(),
    });
    mockExec
      .mockImplementationOnce((_cmd: string, cb: (e: unknown) => void) => cb(null))
      .mockImplementationOnce((_cmd: string, cb: (e: unknown, out: string, err: string) => void) =>
        cb(null, "ok", ""),
      );

    const client = new mod.SshCommandClient(cfg);
    const res = await client.ssh_command({ command: "ls" });

    expect(mockWriteFileSync).toHaveBeenCalledWith("/tmp/tmp.sh", "ls");
    expect(mockExec).toHaveBeenCalledTimes(2);
    expect(res.content).toBe("```\nok\n```");
  });

  it("returns exit code when ssh fails", async () => {
    const remove = jest.fn();
    mockFileSync.mockReturnValue({
      name: "/tmp/tmp.sh",
      removeCallback: remove,
    });
    mockExec
      .mockImplementationOnce((_c: string, cb: (e: unknown) => void) => cb(null))
      .mockImplementationOnce((_c: string, cb: (e: unknown, out: string, err: string) => void) => {
        const err = new Error("Command failed: ssh boom");
        (err as unknown as { code: number }).code = 1;
        cb(err, "sout", "serr");
      });

    const client = new mod.SshCommandClient(cfg);
    const res = await client.ssh_command({ command: "do" });
    expect(res.content).toContain("Exit code: 1");
    expect(remove).toHaveBeenCalled();
  });

  it("getUserHost defaults", () => {
    const client = new mod.SshCommandClient({
      name: "c",
      agent_name: "a",
      completionParams: {},
      chatParams: {},
      toolParams: {},
    } as ConfigChatType);
    expect(client.getUserHost()).toEqual({
      user: "root",
      host: "localhost",
      strictHostKeyChecking: false,
    });
  });

  it("options_string and systemMessage", () => {
    const client = new mod.SshCommandClient(cfg);
    const str = client.options_string('{"command":"echo hi"}');
    expect(str).toContain("`ssh u@h`");
    expect(str).toContain("echo hi");
    expect(client.systemMessage()).toContain("u@h");
  });

  it("call returns instance", () => {
    expect(mod.call(cfg)).toBeInstanceOf(mod.SshCommandClient);
  });
});
