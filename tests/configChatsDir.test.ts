import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { mkdtempSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import * as yaml from "js-yaml";
import type { ConfigChatType } from "../src/types.ts";

describe("chats dir mode", () => {
  let mod: typeof import("../src/config.ts");
  let tmp: string;
  let configPath: string;
  let chatFile: string;

  beforeEach(async () => {
    jest.restoreAllMocks();
    jest.resetModules();
    jest.unstable_mockModule("../src/helpers/readGoogleSheet", () => ({
      readGoogleSheet: jest.fn().mockResolvedValue([
        ["name", "prompt"],
        ["b", "p"],
      ]),
    }));
    tmp = mkdtempSync(path.join(os.tmpdir(), "cfg-"));
    const chatsDir = path.join(tmp, "chats");
    mod = await import("../src/config.ts");
    const cfg = mod.generateConfig();
    cfg.useChatsDir = true;
    cfg.chatsDir = chatsDir;
    cfg.chats = [{ name: "test", id: 1 } as ConfigChatType];
    configPath = path.join(tmp, "config.yml");
    mod.writeConfig(configPath, cfg);
    mod.setConfigPath(configPath);
    process.env.CONFIG = configPath;
    mod.reloadConfig();
    chatFile = path.join(chatsDir, "test.yml");
  });

  afterEach(() => {
    delete process.env.CONFIG;
  });

  it("updateChatInConfig writes only chat file", () => {
    const beforeCfg = yaml.load(readFileSync(configPath, "utf8")) as Record<
      string,
      unknown
    >;
    const updated: ConfigChatType = {
      ...mod.useConfig().chats[0],
      description: "new",
    };
    mod.updateChatInConfig(updated);
    const afterCfg = yaml.load(readFileSync(configPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(afterCfg.useChatsDir).toBe(true);
    expect(afterCfg.chatsDir).toBe(beforeCfg.chatsDir);
    expect("chats" in afterCfg).toBe(false);
    const saved = yaml.load(readFileSync(chatFile, "utf8")) as ConfigChatType;
    expect(saved.description).toBe("new");
  });

  it("syncButtons updates chat file", async () => {
    const beforeCfg = yaml.load(readFileSync(configPath, "utf8")) as Record<
      string,
      unknown
    >;
    const chat = {
      ...mod.useConfig().chats[0],
      buttonsSync: { sheetId: "id", sheetName: "name" },
    } as ConfigChatType;
    await mod.syncButtons(chat, {} as unknown as Record<string, unknown>);
    const afterCfg = yaml.load(readFileSync(configPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(afterCfg.useChatsDir).toBe(true);
    expect(afterCfg.chatsDir).toBe(beforeCfg.chatsDir);
    expect("chats" in afterCfg).toBe(false);
    const saved = yaml.load(readFileSync(chatFile, "utf8")) as ConfigChatType;
    expect(saved.buttonsSynced).toEqual([{ name: "b", prompt: "p" }]);
  });
});
