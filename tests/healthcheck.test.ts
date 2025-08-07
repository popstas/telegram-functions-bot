import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { EventEmitter } from "events";

const mockGet = jest.fn();

jest.unstable_mockModule("http", () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => mockGet(...args) },
  get: (...args: unknown[]) => mockGet(...args),
}));

let runHealthcheck: typeof import("../src/healthcheck").runHealthcheck;
type HealthResponse = import("../src/healthcheck").HealthResponse;
let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

beforeEach(async () => {
  jest.resetModules();
  mockGet.mockReset();
  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  const healthcheck = await import("../src/healthcheck");
  runHealthcheck = healthcheck.runHealthcheck;
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

function mockResponse(path: string, status: number, data: string) {
  mockGet.mockImplementationOnce(
    (_opts: unknown, cb: (res: EventEmitter & { statusCode?: number }) => void) => {
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

function mockErrorResponse(error: Error) {
  mockGet.mockImplementationOnce(() => {
    const req = new EventEmitter();
    process.nextTick(() => {
      req.emit("error", error);
    });
    return req;
  });
}

describe("runHealthcheck", () => {
  it("returns true on healthy response", async () => {
    mockResponse("/ping", 200, "pong");
    mockResponse("/health", 200, JSON.stringify({ healthy: true, errors: [] } as HealthResponse));
    await expect(runHealthcheck()).resolves.toBe(true);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("returns false on ping failure", async () => {
    mockResponse("/ping", 500, "");
    await expect(runHealthcheck()).resolves.toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith("Ping failed");
  });

  it("returns false on ping request error", async () => {
    mockErrorResponse(new Error("Network error"));
    await expect(runHealthcheck()).resolves.toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith("Ping failed");
  });

  it("returns false when health endpoint is unavailable", async () => {
    mockResponse("/ping", 200, "pong");
    mockResponse("/health", 500, "");
    await expect(runHealthcheck()).resolves.toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith("Health endpoint unavailable");
  });

  it("returns false on health request error", async () => {
    mockResponse("/ping", 200, "pong");
    mockErrorResponse(new Error("Network error"));
    await expect(runHealthcheck()).resolves.toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith("Health endpoint unavailable");
  });

  it("returns false on invalid health response format", async () => {
    mockResponse("/ping", 200, "pong");
    mockResponse("/health", 200, "oops");
    await expect(runHealthcheck()).resolves.toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith("Invalid health response");
  });

  it("returns false when health check fails with errors", async () => {
    mockResponse("/ping", 200, "pong");
    mockResponse(
      "/health",
      200,
      JSON.stringify({
        healthy: false,
        errors: ["Service unavailable"],
      } as HealthResponse),
    );
    await expect(runHealthcheck()).resolves.toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith("Service unavailable");
  });

  it("handles multiple errors in health response", async () => {
    mockResponse("/ping", 200, "pong");
    mockResponse(
      "/health",
      200,
      JSON.stringify({
        healthy: false,
        errors: ["Service unavailable", "Connection timeout"],
      } as HealthResponse),
    );
    await expect(runHealthcheck()).resolves.toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith("Service unavailable\nConnection timeout");
  });
});
