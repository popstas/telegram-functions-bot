import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Request, Response } from "express";

// Mock modules
const mockUseConfig = jest.fn();
const mockResolveChatTools = jest.fn();
const mockRequestGptAnswer = jest.fn();
const mockLog = jest.fn();

// Mock the modules
jest.unstable_mockModule("../src/config.ts", () => ({
  useConfig: () => mockUseConfig(),
  updateChatInConfig: jest.fn(),
}));

jest.unstable_mockModule("../src/helpers/gpt/tools.ts", () => ({
  resolveChatTools: (...args: unknown[]) => mockResolveChatTools(...args),
  getToolsPrompts: jest.fn(),
  executeTools: jest.fn(),
}));

jest.unstable_mockModule("../src/helpers/gpt/llm.ts", () => ({
  requestGptAnswer: (...args: unknown[]) => mockRequestGptAnswer(...args),
}));

jest.unstable_mockModule("../src/helpers.ts", () => ({
  __esModule: true,
  log: mockLog,
  agentNameToId: (str: string): number => {
    // Simple hash function for testing
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  },
  safeFilename: jest.fn(),
  ensureDirectoryExists: jest.fn(),
  stringToId: (value: string) => {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      const char = value.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  },
}));

// Import the function to test after setting up mocks
const { toolPostHandler } = await import("../src/httpHandlers");

describe("toolPostHandler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseConfig.mockReturnValue({
      http: { http_token: "token" },
      chats: [
        {
          agent_name: "agent",
          completionParams: {},
          chatParams: {},
          toolParams: {},
        },
      ],
    });
    type MockTool = {
      name: string;
      module: {
        call: jest.Mock;
      };
    };

    const mockTool: MockTool = {
      name: "echo",
      module: {
        call: jest.fn().mockReturnValue({
          functions: {
            get: () => async (args: string) => ({
              content: JSON.stringify({
                content: [{ type: "text", text: args }],
              }),
            }),
          },
          toolSpecs: { type: "function", function: { name: "echo" } },
        }),
      },
    };
    (mockResolveChatTools as jest.Mock).mockResolvedValue([mockTool]);
  });

  function createRes() {
    return {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      end: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
    } as unknown as Response;
  }

  it("returns tool result when authorized", async () => {
    // Setup mock tool
    const mockTool = {
      name: "echo",
      module: {
        call: jest.fn().mockReturnValue({
          functions: {
            get: () => async (args: string) => ({
              content: JSON.stringify({
                content: [{ type: "text", text: args }],
              }),
            }),
          },
          toolSpecs: { type: "function", function: { name: "echo" } },
        }),
      },
    };
    (mockResolveChatTools as jest.Mock).mockResolvedValue([mockTool]);

    const req = {
      params: { agentName: "agent", toolName: "echo" },
      body: { a: 1 },
      headers: { authorization: "Bearer token" },
      query: {},
      get: () => "",
      header: () => "",
      accepts: () => [""],
    } as unknown as Request;

    const res = createRes();
    await toolPostHandler(req, res);

    // Check that the response is a JSON object with the expected content
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ a: 1 }));
  });

  it("uses chat http_token when present", async () => {
    mockUseConfig.mockReturnValue({
      http: { http_token: "global" },
      chats: [
        {
          agent_name: "agent",
          completionParams: {},
          chatParams: {},
          toolParams: {},
          http_token: "chat",
        },
      ],
    });

    const req = {
      params: { agentName: "agent", toolName: "echo" },
      body: { b: 2 },
      headers: { authorization: "Bearer chat" },
      query: {},
      get: () => "",
      header: () => "",
      accepts: () => [""],
    } as unknown as Request;

    const res = createRes();
    await toolPostHandler(req, res);

    expect(res.json).toHaveBeenCalled();
  });

  it("rejects unauthorized request", async () => {
    mockUseConfig.mockReturnValue({
      http: { http_token: "global" },
      chats: [
        {
          agent_name: "agent",
          completionParams: {},
          chatParams: {},
          toolParams: {},
          http_token: "chat",
        },
      ],
    });

    const req = {
      params: { agentName: "agent", toolName: "echo" },
      body: {},
      headers: { authorization: "Bearer wrong" },
      query: {},
      get: () => "",
      header: () => "",
      accepts: () => [""],
    } as unknown as Request;
    const res = createRes();
    await toolPostHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
