import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockRequest = jest.fn();
const mockReadConfig = jest.fn();

jest.unstable_mockModule("../src/helpers/gpt/llm.ts", () => ({
  requestGptAnswer: mockRequest,
}));

jest.unstable_mockModule("../src/config.ts", () => ({
  readConfig: mockReadConfig,
}));

const { runAgent } = await import("../src/cli-agent.ts");

describe("runAgent", () => {
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
    mockRequest.mockResolvedValue({ content: "ok" });
  });

  it("calls requestGptAnswer and returns result", async () => {
    const progress = jest.fn();
    const res = await runAgent("test", "hi", progress);
    expect(res).toBe("ok");
    expect(mockRequest).toHaveBeenCalled();
    const ctx = mockRequest.mock.calls[0][2];
    expect(ctx.noSendTelegram).toBe(true);
    expect(ctx.progressCallback).toBe(progress);
  });
});
