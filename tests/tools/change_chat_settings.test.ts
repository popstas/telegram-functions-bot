import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type {
  ConfigChatType,
  ConfigType,
  ThreadStateType,
} from "../../src/types";

const mockReadConfig = jest.fn();
const mockWriteConfig = jest.fn();
const mockGeneratePrivateChatConfig = jest.fn();

jest.unstable_mockModule("../../src/config.ts", () => ({
  __esModule: true,
  readConfig: () => mockReadConfig(),
  writeConfig: (...args: unknown[]) => mockWriteConfig(...args),
  generatePrivateChatConfig: (...args: unknown[]) =>
    mockGeneratePrivateChatConfig(...args),
}));

let ChangeChatSettingsClient: typeof import("../../src/tools/change_chat_settings.ts").ChangeChatSettingsClient;
let callFn: typeof import("../../src/tools/change_chat_settings.ts").call;

beforeEach(async () => {
  jest.resetModules();
  mockReadConfig.mockReset();
  mockWriteConfig.mockReset();
  mockGeneratePrivateChatConfig.mockReset();
  ({ ChangeChatSettingsClient, call: callFn } = await import(
    "../../src/tools/change_chat_settings.ts"
  ));
});

describe("ChangeChatSettingsClient", () => {
  it("updates existing chat settings", async () => {
    const chat = {
      name: "chat1",
      username: "user1",
      completionParams: { model: "gpt" },
      chatParams: {},
      toolParams: {},
    } as ConfigChatType;
    const config: ConfigType = {
      bot_name: "bot",
      auth: { bot_token: "", chatgpt_api_key: "" },
      privateUsers: [],
      local_models: [],
      http: {},
      chats: [chat],
    } as unknown as ConfigType;

    mockReadConfig.mockReturnValue(config);

    const client = new ChangeChatSettingsClient(chat, {
      id: 1,
      msgs: [],
      messages: [],
    } as ThreadStateType);
    const res = await client.change_chat_settings({ confirmation: true });

    expect(res.content).toContain("Chat settings updated");
    expect(config.chats[0].chatParams.confirmation).toBe(true);
    expect(mockWriteConfig).toHaveBeenCalledWith("config.yml", config);
  });

  it("creates new chat when not found", async () => {
    const existing = {
      name: "old",
      username: "olduser",
      completionParams: { model: "gpt" },
      chatParams: {},
      toolParams: {},
    } as ConfigChatType;
    const config: ConfigType = {
      bot_name: "bot",
      auth: { bot_token: "", chatgpt_api_key: "" },
      privateUsers: [],
      local_models: [],
      http: {},
      chats: [existing],
    } as unknown as ConfigType;
    const newChat = {
      name: "Private newuser",
      username: "newuser",
      chatParams: {},
      toolParams: {},
    } as ConfigChatType;
    mockGeneratePrivateChatConfig.mockReturnValue(newChat);
    mockReadConfig.mockReturnValue(config);

    const client = new ChangeChatSettingsClient(
      {
        username: "newuser",
        completionParams: { model: "gpt" },
        chatParams: {},
        toolParams: {},
      } as ConfigChatType,
      { id: 99, msgs: [], messages: [] } as ThreadStateType,
    );
    await client.change_chat_settings({ confirmation: true });

    expect(mockGeneratePrivateChatConfig).toHaveBeenCalledWith("newuser");
    expect(config.chats[1]).toMatchObject({
      username: "newuser",
      chatParams: { confirmation: true },
    });
    expect(mockWriteConfig).toHaveBeenCalledWith("config.yml", config);
  });

  it("formats option string", () => {
    const chat = {
      completionParams: { model: "g" },
      chatParams: {},
      toolParams: {},
    } as ConfigChatType;
    const client = new ChangeChatSettingsClient(chat, {
      id: 1,
      msgs: [],
      messages: [],
    } as ThreadStateType);
    const str = client.options_string('{"debug":true,"forgetTimeout":10}');
    expect(str).toBe("**Change settings:** `debug: true, forgetTimeout: 10`");
  });
});

export {};
