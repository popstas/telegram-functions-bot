import { jest, describe, it, beforeEach, expect } from "@jest/globals";
import type { OAuth2Client } from "google-auth-library";
import { ConfigChatType } from "../src/types.ts";
const mockLog = jest.fn();
const mockWriteFile = jest.fn();
const mockExistsSync = jest.fn().mockReturnValue(true);
const mockReadFileSync = jest.fn().mockReturnValue("");
const mockWatchFile = jest.fn();
const mockDebounce = jest.fn((fn) => fn);
const mockUseThreads = jest.fn(() => ({}));
const mockLoad = jest.fn();
const mockDump = jest.fn((obj) => JSON.stringify(obj));

jest.unstable_mockModule("../src/helpers.ts", () => ({
  log: mockLog,
  safeFilename: jest.fn(),
}));

jest.unstable_mockModule("lodash.debounce", () => ({
  __esModule: true,
  default: (fn: unknown) => mockDebounce(fn),
}));

jest.unstable_mockModule("../src/threads.ts", () => ({
  useThreads: () => mockUseThreads(),
}));

jest.unstable_mockModule("lodash.debounce", () => ({
  __esModule: true,
  default: (fn: unknown) => mockDebounce(fn),
}));

jest.unstable_mockModule("js-yaml", () => ({
  __esModule: true,
  load: (...args: unknown[]) => mockLoad(...args),
  dump: (...args: unknown[]) => mockDump(...args),
}));

jest.unstable_mockModule("fs", () => ({
  __esModule: true,
  default: {
    writeFileSync: mockWriteFile,
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    watchFile: mockWatchFile,
  },
  writeFileSync: mockWriteFile,
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  watchFile: mockWatchFile,
}));

let mod: typeof import("../src/config.ts");

beforeEach(async () => {
  jest.resetModules();
  mockLog.mockClear();
  mockWriteFile.mockClear();
  mockDebounce.mockClear();
  mockUseThreads.mockClear();
  mockWatchFile.mockClear();
  mockExistsSync.mockClear();
  mockReadFileSync.mockClear();
  mod = await import("../src/config.ts");
});

describe("validateConfig", () => {
  it("returns false and logs when tokens missing", () => {
    const cfg = mod.generateConfig();
    const valid = mod.validateConfig(cfg);
    expect(valid).toBe(false);
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining("No auth.bot_token"),
      }),
    );
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining("No auth.chatgpt_api_key"),
      }),
    );
  });

  it("returns true when tokens provided", () => {
    const cfg = mod.generateConfig();
    cfg.auth.bot_token = "token";
    cfg.auth.chatgpt_api_key = "key";
    const valid = mod.validateConfig(cfg);
    expect(valid).toBe(true);
    expect(mockLog).not.toHaveBeenCalled();
  });
});

describe("generatePrivateChatConfig", () => {
  it("creates private chat config", () => {
    const cfg = mod.generatePrivateChatConfig("alice");
    expect(cfg).toEqual({
      name: "Private alice",
      username: "alice",
      toolParams: {},
      chatParams: {},
    });
  });
});

describe("logConfigChanges", () => {
  it("writes diff when configs differ", () => {
    const oldCfg = mod.generateConfig();
    const newCfg = mod.generateConfig();
    newCfg.bot_name = "new";
    mod.logConfigChanges(oldCfg, newCfg);
    expect(mockLog).toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalledWith(
      "data/last-config-change.diff",
      expect.any(String),
    );
  });

  it("does nothing when configs equal", () => {
    const cfg = mod.generateConfig();
    mod.logConfigChanges(cfg, cfg);
    expect(mockLog).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

describe("getGoogleButtons", () => {
  beforeEach(async () => {
    jest.resetModules();
  });

  it("returns undefined when sheet fails", async () => {
    jest.unstable_mockModule("../src/helpers/readGoogleSheet", () => ({
      readGoogleSheet: jest.fn().mockResolvedValue(undefined),
    }));
    mod = await import("../src/config.ts");
    const auth = {} as unknown as OAuth2Client;
    const res = await mod.getGoogleButtons(
      { sheetId: "id", sheetName: "s" },
      auth,
    );
    expect(res).toBeUndefined();
  });

  it("parses rows to buttons", async () => {
    jest.unstable_mockModule("../src/helpers/readGoogleSheet", () => ({
      readGoogleSheet: jest.fn().mockResolvedValue([
        ["name", "prompt"],
        ["btn", "pr", 1, "wait"],
        ["#comment", "foo"],
      ]),
    }));
    mod = await import("../src/config.ts");
    const auth = {} as unknown as OAuth2Client;
    const res = await mod.getGoogleButtons(
      { sheetId: "id", sheetName: "s" },
      auth,
    );
    expect(res).toEqual([
      { name: "btn", prompt: "pr", row: 1, waitMessage: "wait" },
    ]);
  });
});

describe("watchConfigChanges", () => {
  it("reloads config and updates threads", async () => {
    const threads = { 1: { completionParams: { model: "old" } } } as Record<
      number,
      { completionParams: Record<string, unknown> }
    >;
    mockUseThreads.mockReturnValue(threads);
    mod = await import("../src/config.ts");
    const oldCfg = mod.generateConfig();
    oldCfg.chats = [
      { name: "test", id: 1, completionParams: { model: "old" } },
    ] as ConfigChatType[];
    const newCfg = {
      ...oldCfg,
      chats: [{ name: "test", id: 1, completionParams: { model: "new" } }],
    } as typeof oldCfg;

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("yaml");
    mockLoad.mockReturnValueOnce(oldCfg).mockReturnValueOnce(newCfg);
    mod.reloadConfig();
    mockWatchFile.mockClear();
    mockWatchFile.mockClear();

    mod.watchConfigChanges();

    expect(mockWatchFile).toHaveBeenCalledWith(
      "config.yml",
      expect.any(Function),
    );
    const cb = mockWatchFile.mock.calls[0][1] as () => void;
    cb();

    expect(mockWatchFile).toHaveBeenCalled();
    expect(threads[1].completionParams).toEqual({ model: "new" });
  });
});
