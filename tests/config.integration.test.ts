import { jest } from "@jest/globals";
import path from "path";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "os";
import { ConfigChatType, ConfigType } from "../src/types.ts";

// mock external modules to keep memory usage low
jest.unstable_mockModule("../src/helpers/readGoogleSheet", () => ({
  readGoogleSheet: jest.fn(),
}));
jest.unstable_mockModule("google-auth-library", () => ({
  OAuth2Client: class {},
  GoogleAuth: class {},
}));

const config = await import("../src/config.ts");
const { readConfig, writeConfig, generateConfig, convertChatConfig, setConfigPath } = config;
const yaml = await import("js-yaml");

describe("config integration", () => {
  it("loads chats from files and updates chat file", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "cfg-"));
    const chatsDir = path.join(tmp, "data", "chats");
    mkdirSync(chatsDir, { recursive: true });
    writeFileSync(path.join(chatsDir, "a.yml"), "name: a\n");
    writeFileSync(path.join(chatsDir, "b.yml"), "name: b\n");
    const cfg = generateConfig();
    cfg.useChatsDir = true;
    cfg.chatsDir = chatsDir;
    cfg.chats = [];
    const configPath = path.join(tmp, "config.yml");
    writeConfig(configPath, cfg);
    const loaded = readConfig(configPath);
    expect(loaded.chats.map((c) => c.name)).toEqual(["a", "b"]);
    const chatFile = path.join(chatsDir, "a.yml");
    const before = readFileSync(chatFile, "utf8");
    loaded.chats[0].description = "updated";
    writeConfig(configPath, loaded);
    const after = readFileSync(chatFile, "utf8");
    expect(after).not.toBe(before);
    expect(after).toMatch(/description: updated/);
  });

  it("splits and merges config using convertChatConfig", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "cfg-"));
    const configPath = path.join(tmp, "config.yml");
    const chatsDir = path.join(tmp, "data", "chats");
    const cfg = generateConfig();
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
    writeConfig(configPath, cfg);
    setConfigPath(configPath);

    convertChatConfig("split");
    const splitCfg = yaml.load(readFileSync(configPath, "utf8")) as ConfigType;
    expect(splitCfg.useChatsDir).toBe(true);
    expect(splitCfg.chats).toBeUndefined();
    const chatFile = path.join(chatsDir, "chat1.yml");
    const saved = yaml.load(readFileSync(chatFile, "utf8")) as ConfigChatType;
    expect(saved.name).toBe("chat1");

    convertChatConfig("merge");
    const mergedCfg = yaml.load(readFileSync(configPath, "utf8")) as ConfigType;
    expect(mergedCfg.useChatsDir).toBe(false);
    expect(mergedCfg.chats[0].name).toBe("chat1");
  });
});
