import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import type { Request, Response } from "express";

const mockUseConfig = jest.fn();
const mockRequestGptAnswer = jest.fn();
const mockAddToHistory = jest.fn();
const mockLog = jest.fn();

jest.unstable_mockModule("../src/config.ts", () => ({
  __esModule: true,
  useConfig: () => mockUseConfig(),
  readConfig: () => ({}),
  updateChatInConfig: jest.fn(),
}));

jest.unstable_mockModule("../src/helpers/gpt/llm.ts", () => ({
  __esModule: true,
  requestGptAnswer: (...args: unknown[]) => mockRequestGptAnswer(...args),
}));

jest.unstable_mockModule("../src/helpers/history.ts", () => ({
  __esModule: true,
  addToHistory: (...args: unknown[]) => mockAddToHistory(...args),
  forgetHistoryOnTimeout: () => undefined,
}));

jest.unstable_mockModule("../src/helpers.ts", () => ({
  __esModule: true,
  log: (...args: unknown[]) => mockLog(...args),
  agentNameToId: (name: string) => name.length,
  sendToHttp: jest.fn(),
  safeFilename: jest.fn(),
  ensureDirectoryExists: jest.fn(),
  stringToId: (value: string) => value.length,
}));

let agentPostHandler: typeof import("../src/httpHandlers.ts").agentPostHandler;
let agentGetHandler: typeof import("../src/httpHandlers.ts").agentGetHandler;

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    contentType: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

beforeEach(async () => {
  jest.resetModules();
  mockUseConfig.mockReset();
  mockRequestGptAnswer.mockReset();
  mockAddToHistory.mockReset();
  mockLog.mockReset();
  ({ agentPostHandler, agentGetHandler } = await import("../src/httpHandlers.ts"));
});

afterEach(() => {
  (global.fetch as unknown as jest.Mock | undefined)?.mockRestore?.();
});

describe("agentGetHandler", () => {
  it("responds with status info", async () => {
    const res = createRes();
    await agentGetHandler({ params: { agentName: "a" } } as unknown as Request, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ name: "a", status: "online" }));
  });
});

describe("agentPostHandler", () => {
  const baseConfig = {
    http: { http_token: "t" },
    chats: [
      {
        agent_name: "agent",
        completionParams: {},
        chatParams: {},
        toolParams: {},
      },
    ],
  };

  it("rejects unauthorized requests", async () => {
    mockUseConfig.mockReturnValue(baseConfig);
    const req = {
      params: { agentName: "agent" },
      body: { text: "hi" },
      headers: { authorization: "Bearer bad" },
    } as unknown as Request;
    const res = createRes();
    await agentPostHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects missing text", async () => {
    mockUseConfig.mockReturnValue(baseConfig);
    const req = {
      params: { agentName: "agent" },
      body: {},
      headers: { authorization: "Bearer t" },
    } as unknown as Request;
    const res = createRes();
    await agentPostHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects wrong agent", async () => {
    mockUseConfig.mockReturnValue({ ...baseConfig, chats: [] });
    const req = {
      params: { agentName: "agent" },
      body: { text: "hi" },
      headers: { authorization: "Bearer t" },
    } as unknown as Request;
    const res = createRes();
    await agentPostHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("sends answer when ok", async () => {
    mockUseConfig.mockReturnValue(baseConfig);
    mockRequestGptAnswer.mockResolvedValue({ content: "answer" });
    const req = {
      params: { agentName: "agent" },
      body: { text: "hi" },
      headers: { authorization: "Bearer t" },
    } as unknown as Request;
    const res = createRes();
    await agentPostHandler(req, res);
    expect(mockAddToHistory).toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledWith("answer");
  });

  it("posts webhook when provided", async () => {
    mockUseConfig.mockReturnValue(baseConfig);
    mockRequestGptAnswer.mockResolvedValue({ content: "a" });
    const fetchMock = jest.fn().mockResolvedValue({});
    // @ts-expect-error global.fetch is not a function
    global.fetch = fetchMock;
    const req = {
      params: { agentName: "agent" },
      body: { text: "hi", webhook: "http://w" },
      headers: { authorization: "Bearer t" },
    } as unknown as Request;
    const res = createRes();
    await agentPostHandler(req, res);
    expect(fetchMock).toHaveBeenCalled();
  });
});
