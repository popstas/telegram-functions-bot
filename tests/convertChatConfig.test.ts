import { jest } from "@jest/globals";
import path from "path";
import { mkdtempSync, readFileSync as fsReadFileSync } from "node:fs";
import os from "os";
import { ConfigChatType } from "../src/types.ts";

const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockWriteFileSync = jest.fn();
const mockReaddirSync = jest.fn();
const mockMkdirSync = jest.fn();
const mockDump = jest.fn();
const mockLoad = jest.fn();

jest.unstable_mockModule("fs", () => ({
  __esModule: true,
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    readdirSync: mockReaddirSync,
    mkdirSync: mockMkdirSync,
    watchFile: jest.fn(),
    appendFileSync: jest.fn(),
  },
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  readdirSync: mockReaddirSync,
  mkdirSync: mockMkdirSync,
  watchFile: jest.fn(),
  appendFileSync: jest.fn(),
}));

jest.unstable_mockModule("js-yaml", () => ({
  __esModule: true,
  dump: mockDump,
  load: mockLoad,
}));

const { generateConfig, convertChatConfig } = await import("../src/config.ts");

describe("convertChatConfig", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("splits chats into directory and enables useChatsDir", () => {
    const cfg = generateConfig();
    cfg.chats = [
      {
        name: "chat1",
        completionParams: {},
        chatParams: {},
        toolParams: {},
      } as ConfigChatType,
    ];
    cfg.useChatsDir = false;

    mockExistsSync.mockReturnValueOnce(true).mockReturnValueOnce(false);
    mockReadFileSync.mockReturnValueOnce("cfgYaml");
    mockLoad.mockReturnValueOnce(cfg);
    mockDump.mockReturnValueOnce("chatYaml").mockReturnValueOnce("cfgOut");

    convertChatConfig("split");

    expect(mockMkdirSync).toHaveBeenCalledWith("data/chats", {
      recursive: true,
    });
    expect(mockWriteFileSync).toHaveBeenNthCalledWith(
      1,
      path.join("data/chats", "chat1.yml"),
      "chatYaml",
    );
    expect(mockDump.mock.calls[1][0]).not.toHaveProperty("chats");
    expect(mockDump.mock.calls[1][0]).toMatchObject({ useChatsDir: true });
    expect(mockWriteFileSync).toHaveBeenNthCalledWith(
      2,
      "config.yml",
      "cfgOut",
    );
  });

  it("merges chats from directory and disables useChatsDir", () => {
    const cfg = generateConfig();
    cfg.useChatsDir = true;
    cfg.chats = [];
    const chat1 = { name: "a" } as ConfigChatType;
    const chat2 = { name: "b" } as ConfigChatType;

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync
      .mockReturnValueOnce("cfgYaml")
      .mockReturnValueOnce("aYaml")
      .mockReturnValueOnce("bYaml")
      .mockReturnValueOnce("aYaml")
      .mockReturnValueOnce("bYaml");
    mockLoad
      .mockReturnValueOnce(cfg)
      .mockReturnValueOnce(chat1)
      .mockReturnValueOnce(chat2)
      .mockReturnValueOnce(chat1)
      .mockReturnValueOnce(chat2);
    mockReaddirSync.mockReturnValue(["a.yml", "b.yml"]);
    mockDump.mockReturnValue("cfgOut");

    convertChatConfig("merge");

    expect(mockReaddirSync).toHaveBeenCalledWith("data/chats");
    expect(mockDump).toHaveBeenCalledTimes(1);
    expect(mockDump.mock.calls[0][0]).toMatchObject({
      useChatsDir: false,
      chats: [chat1, chat2],
    });
    expect(mockWriteFileSync).toHaveBeenCalledWith("config.yml", "cfgOut");
    expect(mockMkdirSync).not.toHaveBeenCalled();
  });
});

describe("convertChatConfig real fs", () => {
  it("splits and merges config using temp files", async () => {
    jest.resetModules();
    jest.unstable_mockModule("fs", () => import("fs"));
    jest.unstable_mockModule("js-yaml", () => import("js-yaml"));
    jest.unstable_mockModule("../src/helpers/readGoogleSheet", () => ({
      readGoogleSheet: jest.fn(),
    }));
    jest.unstable_mockModule(
      "google-auth-library/build/src/auth/oauth2client",
      () => ({ OAuth2Client: class {} }),
    );
    jest.unstable_mockModule("google-auth-library", () => ({
      GoogleAuth: class {},
    }));
    const mod = await import("../src/config.ts");
    const yaml = await import("js-yaml");
    const tmp = mkdtempSync(path.join(os.tmpdir(), "cfg-"));
    const configPath = path.join(tmp, "config.yml");
    const chatsDir = path.join(tmp, "data", "chats");
    const cfg = mod.generateConfig();
    cfg.useChatsDir = false;
    cfg.chatsDir = chatsDir;
    cfg.chats = [
      {
        name: "chat1",
        agent_name: "chat1",
        completionParams: {},
        chatParams: {},
        toolParams: {},
      } as ConfigChatType,
    ];
    mod.writeConfig(configPath, cfg);
    mod.setConfigPath(configPath);

    mod.convertChatConfig("split");

    const splitCfg = yaml.load(fsReadFileSync(configPath, "utf8")) as any;
    expect(splitCfg.useChatsDir).toBe(true);
    expect(splitCfg.chats).toBeUndefined();
    const chatFile = path.join(chatsDir, "chat1.yml");
    const saved = yaml.load(fsReadFileSync(chatFile, "utf8")) as ConfigChatType;
    expect(saved.name).toBe("chat1");

    mod.convertChatConfig("merge");
    const mergedCfg = yaml.load(fsReadFileSync(configPath, "utf8")) as any;
    expect(mergedCfg.useChatsDir).toBe(false);
    expect(mergedCfg.chats[0].name).toBe("chat1");
  });
});
