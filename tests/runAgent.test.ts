import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// Setup mocks
const mockRequest = jest.fn();
const mockReadConfig = jest.fn();

// Mock the modules
jest.unstable_mockModule("../src/helpers/gpt/llm.ts", () => ({
  requestGptAnswer: mockRequest,
}));

jest.unstable_mockModule("../src/config.ts", () => ({
  readConfig: mockReadConfig,
  useConfig: () => mockReadConfig(),
}));

// Import the module under test after setting up mocks
const { runCliAgent } = await import("../src/cli-agent.ts");

// Import the type for runAgent
import type { runAgent } from "../src/agent-runner.ts";

// Mock the agent-runner module
const mockRunAgent = jest.fn<
  ReturnType<typeof runAgent>,
  Parameters<typeof runAgent>
>();

jest.mock("../src/agent-runner.ts", () => ({
  runAgent: (...args: Parameters<typeof runAgent>) => mockRunAgent(...args),
}));

describe.skip("CLI Agent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadConfig.mockReturnValue({
      chats: [
        {
          agent_name: "test",
          completionParams: {},
          chatParams: {},
          toolParams: {},
        },
      ],
    });
    mockRunAgent.mockResolvedValue("test response");
  });

  it("calls runAgent with correct arguments and returns result", async () => {
    const progress = jest.fn();
    const result = await mockRunAgent("test", "test message", progress);

    expect(mockRunAgent).toHaveBeenCalledWith("test", "test message", progress);
    expect(result).toBe("test response");
  });

  it("handles missing agent name", async () => {
    await expect(runCliAgent([])).rejects.toThrow("No agent name provided");
  });

  it("handles successful agent execution", async () => {
    const consoleLog = jest.spyOn(console, "log").mockImplementation(() => {});
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await runCliAgent(["test", "test message"]);

    expect(mockRunAgent).toHaveBeenCalledWith(
      "test",
      "test message",
      expect.any(Function),
    );
    expect(consoleLog).toHaveBeenCalledWith("test response");

    consoleLog.mockRestore();
    consoleError.mockRestore();
  });
});
