import { jest, describe, it, beforeEach, expect } from "@jest/globals";
const mockLog = jest.fn();
const mockWriteFile = jest.fn();
const mockExistsSync = jest.fn().mockReturnValue(true);
const mockReadFileSync = jest.fn().mockReturnValue("");
const mockWatchFile = jest.fn();

jest.unstable_mockModule("../src/helpers.ts", () => ({
  log: mockLog,
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
    const res = await mod.getGoogleButtons(
      { sheetId: "id", sheetName: "s" },
      {} as any,
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
    const res = await mod.getGoogleButtons(
      { sheetId: "id", sheetName: "s" },
      {} as any,
    );
    expect(res).toEqual([
      { name: "btn", prompt: "pr", row: 1, waitMessage: "wait" },
    ]);
  });
});
