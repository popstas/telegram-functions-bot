import { jest, describe, it, beforeEach, expect } from "@jest/globals";
import type { Request, Response } from "express";

const mockUseConfig = jest.fn();
const mockLog = jest.fn();

const expressApp = {
  use: jest.fn(),
  get: jest.fn(),
  post: jest.fn(),
  listen: jest.fn(),
};
const mockExpress = jest.fn(() => expressApp);
mockExpress.json = jest.fn(
  () => (_req: Request, _res: Response, next: () => void) => next(),
);

jest.unstable_mockModule("../src/config.ts", () => ({
  __esModule: true,
  useConfig: () => mockUseConfig(),
  validateConfig: jest.fn(),
  writeConfig: jest.fn(),
  watchConfigChanges: jest.fn(),
  readConfig: jest.fn(),
  generatePrivateChatConfig: jest.fn(),
  syncButtons: jest.fn(),
  updateChatInConfig: jest.fn(),
}));

jest.unstable_mockModule("../src/helpers.ts", () => ({
  __esModule: true,
  log: (...args: unknown[]) => mockLog(...args),
  agentNameToId: jest.fn(),
  sendToHttp: jest.fn(),
  ensureDirectoryExists: jest.fn(),
  safeFilename: jest.fn(),
}));

jest.unstable_mockModule("express", () => ({
  __esModule: true,
  default: mockExpress,
}));

let index: typeof import("../src/index.ts");

beforeEach(async () => {
  jest.resetModules();
  mockUseConfig.mockReset();
  mockLog.mockReset();
  expressApp.use.mockClear();
  expressApp.get.mockClear();
  expressApp.post.mockClear();
  expressApp.listen.mockClear();

  index = await import("../src/index.ts");
});

describe("createHttpApp", () => {
  it("returns express app", () => {
    mockUseConfig.mockReturnValue({ http: { port: 3000 } });
    const result = index.createHttpApp();
    expect(result?.app).toBe(expressApp);
    expect(result?.port).toBe(3000);
    expect(expressApp.listen).not.toHaveBeenCalled();
  });

  it("returns null when no http config", () => {
    mockUseConfig.mockReturnValue({});
    const result = index.createHttpApp();
    expect(result).toBeNull();
  });
});
