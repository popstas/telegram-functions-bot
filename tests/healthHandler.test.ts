import { jest, describe, it, beforeEach, expect } from "@jest/globals";
import type { Request, Response } from "express";

const mockUseConfig = jest.fn();
const mockGetBots = jest.fn();
const mockIsMqttConnected = jest.fn();

jest.unstable_mockModule("../src/config.ts", () => ({
  __esModule: true,
  useConfig: () => mockUseConfig(),
  updateChatInConfig: jest.fn(),
}));

jest.unstable_mockModule("../src/bot", () => ({
  __esModule: true,
  getBots: () => mockGetBots(),
}));

jest.unstable_mockModule("../src/mqtt.ts", () => ({
  __esModule: true,
  isMqttConnected: () => mockIsMqttConnected(),
  shutdownMqtt: jest.fn(),
}));

let healthHandler: typeof import("../src/healthcheck.ts").healthHandler;
let getHealthStatus: typeof import("../src/healthcheck.ts").getHealthStatus;

beforeEach(async () => {
  jest.resetModules();
  mockUseConfig.mockReset();
  mockGetBots.mockReset();
  mockIsMqttConnected.mockReset();
  ({ healthHandler, getHealthStatus } = await import("../src/healthcheck.ts"));
});

function createRes() {
  return {
    json: jest.fn(),
  } as unknown as Response;
}

describe("getHealthStatus", () => {
  it("returns healthy state", () => {
    mockUseConfig.mockReturnValue({ mqtt: { host: "h" } });
    mockIsMqttConnected.mockReturnValue(true);
    mockGetBots.mockReturnValue({
      b: {
        polling: { abortController: { signal: { aborted: false } } },
        botInfo: { username: "b" },
      },
    });
    expect(getHealthStatus()).toEqual({ healthy: true, errors: [] });
  });

  it("returns errors when issues", () => {
    mockUseConfig.mockReturnValue({ mqtt: { host: "h" } });
    mockIsMqttConnected.mockReturnValue(false);
    mockGetBots.mockReturnValue({
      b: {
        polling: { abortController: { signal: { aborted: true } } },
        botInfo: { username: "b" },
      },
    });
    expect(getHealthStatus()).toEqual({
      healthy: false,
      errors: ["MQTT is not connected", "Bot b is not running"],
    });
  });
});

describe("healthHandler", () => {
  it("sends status json", () => {
    const res = createRes();
    mockUseConfig.mockReturnValue({ mqtt: { host: "" } });
    mockIsMqttConnected.mockReturnValue(true);
    mockGetBots.mockReturnValue({});
    healthHandler({} as Request, res);
    expect(res.json).toHaveBeenCalledWith({ healthy: true, errors: [] });
  });
});
