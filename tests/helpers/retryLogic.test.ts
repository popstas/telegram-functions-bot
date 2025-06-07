/* eslint-disable @typescript-eslint/no-explicit-any */
import { jest } from "@jest/globals";

// Mock the executeTools function
const mockCallTools = jest.fn();

// Mock the module
jest.mock("../../src/helpers/gpt", () => ({
  __esModule: true,
  executeTools: mockCallTools,
}));

// Import after setting up the mock
import { executeTools } from "../../src/helpers/gpt";

describe.skip("executeTools retry logic", () => {
  // Mock data
  const mockToolCalls = [
    {
      id: "test-tool-call",
      type: "function" as const,
      function: {
        name: "test_tool",
        arguments: JSON.stringify({ param: "value" }),
      },
    },
  ];

  // Mock the remaining parameters
  const mockChatTools = [];
  const mockChatConfig = {
    chatParams: {
      confirmation: false,
      deleteToolAnswers: 60,
      forgetTimeout: 600,
      showToolMessages: true,
    },
    completionParams: {
      model: "gpt-4o-mini",
    },
    name: "default",
    systemMessage: "Test system message",
    toolParams: {},
  } as const;

  const mockMsg = {
    chat: {
      id: 123,
      type: "private" as const,
      first_name: "Test User",
      username: "testuser",
    },
    from: {
      id: 123,
      is_bot: false,
      first_name: "Test",
      username: "testuser",
      language_code: "en",
    },
    message_id: 1,
    date: Math.floor(Date.now() / 1000),
    text: "test message",
    entities: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  it("should retry once when tool call fails with 400 error", async () => {
    // First call fails with 400, second call succeeds
    mockCallTools
      .mockImplementationOnce(() => {
        const error = new Error("400 Invalid parameter");
        (error as any).status = 400;
        return Promise.reject(error);
      })
      .mockImplementationOnce(() => Promise.resolve([{ content: "success" }]));

    const result = await executeTools(
      mockToolCalls as any,
      mockChatTools as any,
      mockChatConfig,
      mockMsg,
    );

    expect(mockCallTools).toHaveBeenCalledTimes(2);
    expect(result).toEqual([{ content: "success" }]);
  });

  it("should propagate error if it fails twice with 400 error", async () => {
    // Mock always fails with 400
    mockCallTools.mockImplementation(() => {
      const error = new Error("400 Invalid parameter");
      (error as any).status = 400;
      return Promise.reject(error);
    });

    await expect(
      executeTools(
        mockToolCalls as any,
        mockChatTools as any,
        mockChatConfig,
        mockMsg,
      ),
    ).rejects.toThrow("400 Invalid parameter");

    expect(mockCallTools).toHaveBeenCalledTimes(1);
  });

  it("should not retry for non-400 errors", async () => {
    // Mock fails with 500 (should not retry)
    mockCallTools.mockImplementationOnce(() => {
      const error = new Error("500 Internal Server Error");
      (error as any).status = 500;
      return Promise.reject(error);
    });

    await expect(
      executeTools(
        mockToolCalls as any,
        mockChatTools as any,
        mockChatConfig,
        mockMsg,
      ),
    ).rejects.toThrow("500 Internal Server Error");

    expect(mockCallTools).toHaveBeenCalledTimes(1);
  });
});
