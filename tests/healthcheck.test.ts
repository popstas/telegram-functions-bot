import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { EventEmitter } from "events";

const mockGet = jest.fn();

jest.unstable_mockModule("http", () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => mockGet(...args) },
  get: (...args: unknown[]) => mockGet(...args),
}));

let runHealthcheck: typeof import("../src/healthcheck").runHealthcheck;

beforeEach(async () => {
  jest.resetModules();
  mockGet.mockReset();
  ({ runHealthcheck } = await import("../src/healthcheck"));
});

function mockResponse(path: string, status: number, data: string) {
  mockGet.mockImplementationOnce(
    (
      _opts: unknown,
      cb: (res: EventEmitter & { statusCode?: number }) => void,
    ) => {
      const res = new EventEmitter() as EventEmitter & { statusCode?: number };
      res.statusCode = status;
      cb(res);
      process.nextTick(() => {
        if (data) res.emit("data", data);
        res.emit("end");
      });
      return { on: jest.fn() } as unknown as EventEmitter;
    },
  );
}

describe("runHealthcheck", () => {
  it("returns true on healthy response", async () => {
    mockResponse("/ping", 200, "pong");
    mockResponse(
      "/health",
      200,
      JSON.stringify({ botsRunning: true, mqttConnected: true }),
    );
    await expect(runHealthcheck()).resolves.toBe(true);
  });

  it("returns false on ping failure", async () => {
    mockResponse("/ping", 500, "");
    await expect(runHealthcheck()).resolves.toBe(false);
  });

  it("returns false on invalid health", async () => {
    mockResponse("/ping", 200, "pong");
    mockResponse("/health", 200, "oops");
    await expect(runHealthcheck()).resolves.toBe(false);
  });
});
