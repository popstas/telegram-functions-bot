import { log, agentNameToId } from "../src/helpers.ts";

describe("log", () => {
  let consoleOutput: string[] = [];
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const originalConsoleInfo = console.info;
  const originalConsoleDebug = console.debug;

  beforeEach(() => {
    consoleOutput = [];
    console.log = (output: string) => consoleOutput.push(output);
    console.error = (output: string) => consoleOutput.push(output);
    console.warn = (output: string) => consoleOutput.push(output);
    console.info = (output: string) => consoleOutput.push(output);
    console.debug = (output: string) => consoleOutput.push(output);
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    console.info = originalConsoleInfo;
    console.debug = originalConsoleDebug;
  });

  it("should log info messages by default", () => {
    log({ msg: "Test info message" });
    expect(consoleOutput).toContainEqual(
      expect.stringContaining("Test info message"),
    );
  });

  it("should log debug messages", () => {
    log({ msg: "Test debug message", logLevel: "debug" });
    expect(consoleOutput).toContainEqual(
      expect.stringContaining("Test debug message"),
    );
  });

  it("should log error messages", () => {
    log({ msg: "Test error message", logLevel: "error" });
    expect(consoleOutput).toContainEqual(
      expect.stringContaining("Test error message"),
    );
  });

  it("should log warn messages", () => {
    log({ msg: "Test warn message", logLevel: "warn" });
    expect(consoleOutput).toContainEqual(
      expect.stringContaining("Test warn message"),
    );
  });

  it("should log info messages", () => {
    log({ msg: "Test info message", logLevel: "info" });
    expect(consoleOutput).toContainEqual(
      expect.stringContaining("Test info message"),
    );
  });

  it("should log messages with chatId, chatTitle, username, and role", () => {
    log({
      msg: "Test message with details",
      chatId: 123,
      chatTitle: "Test Chat",
      username: "testuser",
      role: "user",
    });
    expect(consoleOutput).toContainEqual(
      expect.stringContaining(
        "[123] [Test Chat] [user] [testuser] Test message with details",
      ),
    );
  });
});

describe("agentNameToId", () => {
  it("generates stable positive ids", () => {
    const id1 = agentNameToId("test");
    const id2 = agentNameToId("test");
    expect(id1).toBe(id2);
    expect(id1).toBeGreaterThanOrEqual(0);
  });

  it("produces different ids for different names", () => {
    const a = agentNameToId("a");
    const b = agentNameToId("b");
    expect(a).not.toBe(b);
  });
});
