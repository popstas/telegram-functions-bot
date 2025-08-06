import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { ConfigType } from "../../src/types.ts";

const mockReadConfig = jest.fn();
const mockWriteConfig = jest.fn();

jest.unstable_mockModule("../../src/config.ts", () => ({
  __esModule: true,
  readConfig: () => mockReadConfig(),
  writeConfig: (...args: unknown[]) => mockWriteConfig(...args),
  updateChatInConfig: jest.fn(),
}));

let mod: typeof import("../../src/tools/change_access_settings.ts");

beforeEach(async () => {
  jest.resetModules();
  mockReadConfig.mockReset();
  mockWriteConfig.mockReset();
  mod = await import("../../src/tools/change_access_settings.ts");
});

describe("ChangeAccessSettingsClient", () => {
  function baseConfig(): ConfigType {
    return {
      bot_name: "bot",
      auth: { bot_token: "", chatgpt_api_key: "" },
      adminUsers: ["adm"],
      privateUsers: ["p1"],
      local_models: [],
      http: {},
      chats: [],
    } as unknown as ConfigType;
  }

  it("updates admin and private users", async () => {
    const config = baseConfig();
    mockReadConfig.mockReturnValue(config);
    const client = new mod.ChangeAccessSettingsClient();
    const res = await client.change_access_settings({
      addAdmin: ["new"],
      removeAdmin: ["adm"],
      addPrivate: ["p2"],
    });
    expect(res.content).toContain("updated");
    expect(config.adminUsers).toEqual(["new"]);
    expect(config.privateUsers).toEqual(["p1", "p2"]);
    expect(mockWriteConfig).toHaveBeenCalledWith("config.yml", config);
  });

  it("options_string formats message", () => {
    const client = new mod.ChangeAccessSettingsClient();
    const str = client.options_string(
      '{"addAdmin":["a"],"removePrivate":["b"]}',
    );
    expect(str).toBe("**Change access:** `addAdmin: a; removePrivate: b`");
  });

  it("call returns instance", () => {
    expect(mod.call()).toBeInstanceOf(mod.ChangeAccessSettingsClient);
  });
});

export {};
