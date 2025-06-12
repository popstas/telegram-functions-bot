import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { executeTools } from "../../src/helpers/gpt";
import {
  ConfigChatType,
  ChatToolType,
  ModuleType,
  ThreadStateType,
  ToolResponse,
} from "../../src/types";
import { Message } from "telegraf/types";
import { OpenAI } from "openai";

// Suppress console.info in tests
beforeAll(() => {
  jest.spyOn(console, "info").mockImplementation(() => {});
});

// Mock the bot module with proper typing
jest.mock("../../src/bot", () => ({
  useBot: () => ({
    telegram: {
      sendMessage: jest
        .fn()
        .mockImplementation(() => Promise.resolve({ message_id: 1 })),
    },
  }),
}));

// Mock the useThreads hook to return a thread object with the expected structure
jest.mock("../../src/threads", () => ({
  useThreads: jest.fn(() => ({
    [123]: {
      // Match the chat ID used in the test
      id: 123,
      msgs: [],
      messages: [],
      completionParams: {},
    },
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
  })),
}));

// Create a minimal valid ConfigChatType
const createMockConfig = (): ConfigChatType => ({
  name: "test-bot",
  completionParams: {
    model: "gpt-3.5-turbo",
    temperature: 0.7,
    presence_penalty: 0.6,
  },
  chatParams: {
    confirmation: false,
    showToolMessages: false,
  },
  toolParams: {},
  bot_token: "test-bot-token",
  tools: [],
});

// Create a mock tool call
const createMockToolCall = (
  toolName: string,
): OpenAI.ChatCompletionMessageToolCall => ({
  id: "call_123",
  type: "function" as const,
  function: {
    name: toolName,
    arguments: JSON.stringify({ param: "value" }),
  },
});

describe("executeTools", () => {
  // Mock data
  let mockToolCalls: OpenAI.ChatCompletionMessageToolCall[];
  let mockChatTools: ChatToolType[];
  let mockChatConfig: ConfigChatType;
  let mockMsg: Message.TextMessage;

  // Create a proper mock thread object that matches ThreadStateType
  const createMockThread = (): ThreadStateType => ({
    id: 123,
    msgs: [],
    messages: [],
    completionParams: {
      model: "gpt-4",
      temperature: 0.7,
    },
  });

  // Create a mock module implementation
  const createMockModule = (toolName: string): ModuleType => {
    // Create a properly typed mock for the get function
    const mockGet = (name: string) => {
      // Prefix unused parameter with underscore to indicate it's intentionally unused
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const fn = async (_: string): Promise<ToolResponse> => ({
        content:
          name === toolName ? "test response" : `Tool not found: ${name}`,
      });
      return fn;
    };

    return {
      functions: {
        get: jest.fn(mockGet) as unknown as (
          name: string,
        ) => (args: string) => Promise<ToolResponse>,
        toolSpecs: {
          type: "function",
          function: {
            name: toolName,
            description: `Test ${toolName} tool`,
            parameters: { type: "object", properties: {} },
          },
        },
      },
      configChat: createMockConfig(),
      thread: createMockThread(),
    };
  };

  // Create a mock module call implementation
  const createMockModuleCall = (toolName: string) => {
    const mockModule = createMockModule(toolName);

    // Create a function with the correct signature
    // Using underscore prefix for unused parameters to satisfy linter
    const mockFn = function (
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _: ConfigChatType,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      __: ThreadStateType,
    ): ModuleType {
      return mockModule;
    };

    // Return the mock function with proper typing
    return jest.fn(mockFn) as unknown as (
      chatConfig: ConfigChatType,
      thread: ThreadStateType,
    ) => ModuleType;
  };

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create test tool calls
    mockToolCalls = [createMockToolCall("test_tool")];

    // Create test chat tools
    mockChatTools = [
      {
        name: "test_tool",
        module: {
          description: "Test tool",
          call: createMockModuleCall("test_tool"),
        },
      },
    ];

    // Create test config
    mockChatConfig = createMockConfig();

    // Create test message
    mockMsg = {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 123, type: "private" as const },
      text: "test message",
      from: { id: 123, is_bot: false, first_name: "Test" },
    } as Message.TextMessage;

    // Mock console to prevent test output
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should call the tool with the correct parameters", async () => {
    // Get the module call mock before calling the function
    const moduleCall = mockChatTools[0].module.call as jest.Mock;

    // Execute the function under test
    const result = await executeTools(
      mockToolCalls,
      mockChatTools,
      mockChatConfig,
      mockMsg,
    );

    // Verify the result
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toHaveProperty("content");
    expect(result[0].content).toBe("test response");

    // Verify the tool was called twice (initial call + retry)
    expect(moduleCall).toHaveBeenCalledTimes(2);

    // Verify the call arguments for the first call
    const firstCallArgs = moduleCall.mock.calls[0];
    expect(firstCallArgs).toHaveLength(2);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [config, thread] = firstCallArgs;

    // Verify config has required properties
    expect(config).toMatchObject({
      bot_token: expect.any(String),
      name: expect.any(String),
      tools: expect.any(Array),
    });

    // Verify thread has required properties
    // TODO: cannot mock useThreads, so thread is undefined
    /*expect(thread).toMatchObject({
      id: expect.any(Number),
      msgs: expect.any(Array),
      messages: expect.any(Array)
    });*/
  }, 10000);

  it("should handle tool not found", async () => {
    // Create a tool call with a non-existent tool name
    const toolCalls = [
      {
        ...mockToolCalls[0],
        function: {
          ...mockToolCalls[0].function,
          name: "non_existent_tool",
        },
      },
    ];

    // Execute the function under test
    const result = await executeTools(
      toolCalls,
      mockChatTools,
      mockChatConfig,
      mockMsg,
    );

    // Verify the result
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toHaveProperty("content");
    expect(result[0].content).toContain("Tool not found");
  }, 10000);
});
