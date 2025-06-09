import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Request, Response } from "express";

const mockUseConfig = jest.fn();
const mockResolveChatTools = jest.fn();
const mockRequestGptAnswer = jest.fn();

jest.unstable_mockModule("../src/config.ts", () => ({
  useConfig: () => mockUseConfig(),
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
  log: jest.fn(),
}));

const { toolPostHandler } = await import("../src/httpHandlers.ts");

describe("toolPostHandler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseConfig.mockReturnValue({
      http: { auth_token: "token" },
      chats: [
        {
          agent_name: "agent",
          completionParams: {},
          chatParams: {},
          toolParams: {},
        },
      ],
    });
    const moduleCall = jest.fn(() => ({
      functions: {
        get: () => async (args: string) => ({ content: `echo ${args}` }),
        toolSpecs: { type: "function", function: { name: "echo" } },
      },
    }));
    mockResolveChatTools.mockResolvedValue([
      { name: "echo", module: { call: moduleCall } },
    ]);
  });

  function createRes() {
    const res: Partial<Response> = {};
    res.status = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    res.end = jest.fn();
    return res as Response;
  }

  it("returns tool result when authorized", async () => {
    const req = {
      params: { agentName: "agent", toolName: "echo" },
      body: { args: { a: 1 } },
      headers: { authorization: "Bearer token" },
    } as unknown as Request;
    const res = createRes();
    await toolPostHandler(req, res);
    expect(res.end).toHaveBeenCalledWith('echo {"a":1}');
  });

  it("rejects unauthorized request", async () => {
    const req = {
      params: { agentName: "agent", toolName: "echo" },
      body: {},
      headers: { authorization: "Bearer wrong" },
    } as unknown as Request;
    const res = createRes();
    await toolPostHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
