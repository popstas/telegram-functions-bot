import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { ConfigChatType, ThreadStateType } from "../../src/types";
import type { Message } from "telegraf/types";

const mockBuildMessages = jest.fn();
const mockLlmCall = jest.fn();
const mockReadConfig = jest.fn();

jest.unstable_mockModule("../../src/helpers/gpt.ts", () => ({
  buildMessages: (...args: unknown[]) => mockBuildMessages(...args),
  llmCall: (...args: unknown[]) => mockLlmCall(...args),
}));

jest.unstable_mockModule("../../src/config.ts", () => ({
  readConfig: () => mockReadConfig(),
  updateChatInConfig: jest.fn(),
}));

let mod: typeof import("../../src/tools/brainstorm.ts");

beforeEach(async () => {
  jest.resetModules();
  mockBuildMessages.mockReset();
  mockLlmCall.mockReset();
  mockReadConfig.mockReset();
  mod = await import("../../src/tools/brainstorm.ts");
});

describe("BrainstormClient", () => {
  it("calls buildMessages and llmCall with prompts", async () => {
    const cfg: ConfigChatType = {
      name: "chat",
      agent_name: "agent",
      completionParams: {},
      chatParams: {},
      toolParams: {
        brainstorm: { promptBefore: "BEFORE", promptAfter: "AFTER" },
      },
    } as ConfigChatType;

    const thread: ThreadStateType = {
      id: 1,
      msgs: [{ text: "hi" } as Message.TextMessage],
      messages: [],
    } as ThreadStateType;

    mockBuildMessages.mockResolvedValue([{ role: "system" }]);
    mockLlmCall.mockResolvedValue({
      res: { choices: [{ message: { content: "RES" } }] },
    });

    const client = new mod.BrainstormClient(cfg, thread);
    const res = await client.brainstorm({ systemMessage: "SYS" });

    expect(mockBuildMessages).toHaveBeenCalledWith(
      "SYS\n\nBEFORE",
      thread.messages,
    );
    expect(mockLlmCall).toHaveBeenCalled();
    expect(res.content).toBe("RES\n\nAFTER");
  });

  it("options_string formats text", () => {
    const client = new mod.BrainstormClient(
      {} as ConfigChatType,
      { id: 1, msgs: [], messages: [] } as ThreadStateType,
    );
    expect(client.options_string('{"systemMessage":"p"}')).toBe(
      "**Brainstorm:** `p`",
    );
    expect(client.options_string("{}" as string)).toBe("{}");
  });

  it("call returns instance", () => {
    const client = mod.call(
      {} as ConfigChatType,
      { id: 1, msgs: [], messages: [] } as ThreadStateType,
    );
    expect(client).toBeInstanceOf(mod.BrainstormClient);
  });
});
