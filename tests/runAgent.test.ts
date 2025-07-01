import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockRequest = jest.fn();
const mockReadConfig = jest.fn();

jest.unstable_mockModule("../src/helpers/gpt/llm.ts", () => ({
  requestGptAnswer: mockRequest,
}));

jest.unstable_mockModule("../src/config.ts", () => ({
  readConfig: mockReadConfig,
  useConfig: () => mockReadConfig(),
}));

import type { runAgent } from "../src/agent-runner.ts";
const mockRunAgent = jest.fn<
  ReturnType<typeof runAgent>,
  Parameters<typeof runAgent>
>();
jest.unstable_mockModule("../src/agent-runner.ts", () => ({
  runAgent: (...args: Parameters<typeof runAgent>) => mockRunAgent(...args),
}));

const { runCliAgent } = await import("../src/cli-agent.ts");

describe("CLI Agent", () => {
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

  it("prints response on success", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    await runCliAgent(["test", "hello world"]);
    await Promise.resolve();
    expect(mockRunAgent).toHaveBeenCalledWith(
      "test",
      "hello world",
      expect.any(Function),
    );
    expect(log).toHaveBeenCalledWith("test response");
    log.mockRestore();
  });
});
