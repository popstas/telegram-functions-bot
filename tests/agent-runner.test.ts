import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockReadConfig = jest.fn();
const mockRequestGptAnswer = jest.fn();
const mockAddToHistory = jest.fn();
const mockForgetHistoryOnTimeout = jest.fn();
const mockLog = jest.fn();
const mockAgentNameToId = jest.fn();

afterEach(() => {
  jest.clearAllMocks();
});

jest.unstable_mockModule("../src/config.ts", () => ({
  readConfig: () => mockReadConfig(),
  updateChatInConfig: jest.fn(),
}));

jest.unstable_mockModule("../src/helpers/gpt/llm.ts", () => ({
  requestGptAnswer: (...args: unknown[]) => mockRequestGptAnswer(...args),
}));

jest.unstable_mockModule("../src/helpers/history.ts", () => ({
  addToHistory: (...args: unknown[]) => mockAddToHistory(...args),
  forgetHistoryOnTimeout: (...args: unknown[]) => mockForgetHistoryOnTimeout(...args),
}));

jest.unstable_mockModule("../src/helpers.ts", () => ({
  __esModule: true,
  log: (...args: unknown[]) => mockLog(...args),
  agentNameToId: (...args: unknown[]) => mockAgentNameToId(...args),
  safeFilename: jest.fn(),
  stringToId: jest.fn(),
}));

let runAgent: typeof import("../src/agent-runner.ts").runAgent;

beforeEach(async () => {
  jest.resetModules();
  ({ runAgent } = await import("../src/agent-runner.ts"));
});

describe("runAgent", () => {
  it("sends message to GPT and returns answer", async () => {
    mockAgentNameToId.mockReturnValue(42);
    const chat = {
      agent_name: "test",
      id: 123,
      completionParams: {},
      chatParams: {},
      toolParams: {},
    };
    mockReadConfig.mockReturnValue({ chats: [chat] });
    mockRequestGptAnswer.mockResolvedValue({ content: "answer" });

    const res = await runAgent("test", "hi");

    expect(res).toBe("answer");
    const msg = mockRequestGptAnswer.mock.calls[0][0];
    expect(msg.text).toBe("hi");
    expect(mockAddToHistory).toHaveBeenCalledWith(msg, chat);
    expect(mockForgetHistoryOnTimeout).toHaveBeenCalledWith(chat, msg);
    const ctx = mockRequestGptAnswer.mock.calls[0][2];
    expect(ctx.noSendTelegram).toBe(true);
  });

  it("throws if agent not found", async () => {
    mockReadConfig.mockReturnValue({ chats: [] });
    await expect(runAgent("missing", "hi")).rejects.toThrow("Agent not found: missing");
  });
});
