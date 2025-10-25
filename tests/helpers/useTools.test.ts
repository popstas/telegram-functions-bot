import { jest, describe, it, beforeEach, expect } from "@jest/globals";
import * as fs from "fs";

const mockReaddirSync = jest.fn();
const mockLog = jest.fn();
const mockReadConfig = jest.fn();

// Mock function with type assertion
const mockInitMcp = jest.fn() as unknown as jest.MockedFunction<
  typeof import("../../src/mcp").init
>;

beforeEach(() => {
  mockInitMcp.mockClear();
  mockInitMcp.mockResolvedValue([]);
});
const mockCallMcp = jest.fn();

jest.unstable_mockModule("fs", () => ({
  __esModule: true,
  ...(jest.requireActual("fs") as object),
  readdirSync: mockReaddirSync,
}));

jest.unstable_mockModule("../../src/helpers.ts", () => ({
  __esModule: true,
  log: (...args: unknown[]) => mockLog(...args),
  ensureDirectoryExists: jest.fn(),
  stringToId: jest.fn(),
}));

jest.unstable_mockModule("../../src/config.ts", () => ({
  readConfig: () => mockReadConfig(),
  updateChatInConfig: jest.fn(),
}));

jest.unstable_mockModule("../../src/mcp.ts", () => ({
  init: (config: Parameters<typeof import("../../src/mcp").init>[0]) => mockInitMcp(config),
  callMcp: (...args: unknown[]) => mockCallMcp(...args),
}));

import path from "path";
import { ConfigChatType, ThreadStateType } from "../../src/types.ts";

let useTools: typeof import("../../src/helpers/useTools.ts").default;
let initTools: typeof import("../../src/helpers/useTools.ts").initTools;

const fooPath = path.resolve("src/tools/foo.ts");
const barPath = path.resolve("src/tools/bar.ts");

beforeAll(() => {
  fs.writeFileSync(fooPath, "export function call() { return { content: 'foo' }; }");
  fs.writeFileSync(barPath, "export const notCall = true;\n");
});

afterAll(() => {
  fs.unlinkSync(fooPath);
  fs.unlinkSync(barPath);
});

beforeEach(async () => {
  jest.resetModules();
  jest.clearAllMocks();
  mockReaddirSync.mockReturnValue(["foo.ts", "bar.ts"]);
  mockReadConfig.mockReturnValue({});
  mockInitMcp.mockResolvedValue(
    [] as Array<{
      name: string;
      description: string;
      properties: unknown;
      model: string;
    }>,
  );
  ({ default: useTools, initTools } = await import("../../src/helpers/useTools.ts"));
});

describe("initTools", () => {
  it("loads tools and warns on missing call", async () => {
    const tools = await initTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("foo");
    expect(mockLog).toHaveBeenCalledWith({
      msg: "Function bar has no call() method",
      logLevel: "warn",
    });
  });

  it("caches tools via useTools", async () => {
    const t1 = await useTools();
    const t2 = await useTools();
    expect(t1).toBe(t2);
    expect(mockReaddirSync).toHaveBeenCalledTimes(1);
  });

  it("adds MCP tools from initMcp", async () => {
    mockReadConfig.mockReturnValue({ mcpServers: { m1: {} } });

    // Create a properly typed mock tool
    const mockTools: Array<{
      name: string;
      description: string;
      properties: Record<string, unknown>;
      model: string;
    }> = [{ name: "mcp", description: "d", properties: {}, model: "m1" }];

    // Type the mock implementation
    (mockInitMcp as unknown as jest.Mock).mockImplementation(() => Promise.resolve(mockTools));

    const tools = await initTools();
    expect(tools).toHaveLength(2);
    const mcpTool = tools.find((t) => t.name === "mcp");
    expect(mcpTool).toBeDefined();
    if (!mcpTool) return;

    const instance = mcpTool.module.call(
      {} as unknown as ConfigChatType,
      {} as unknown as ThreadStateType,
    );
    await instance.functions.get("foo")("{}");
    expect(mockCallMcp).toHaveBeenCalledWith("m1", "foo", "{}");
  });

  it("waits for initTools when called concurrently", async () => {
    const tempToolName = "temp_delay.ts";
    const tempToolPath = path.resolve(`src/tools/${tempToolName}`);
    fs.writeFileSync(
      tempToolPath,
      "await new Promise(r => setTimeout(r, 50)); export function call() { return { content: 'delay' }; }\n",
    );
    mockReaddirSync.mockReturnValue([tempToolName]);
    jest.resetModules();
    ({ default: useTools, initTools } = await import("../../src/helpers/useTools.ts"));

    const initPromise = initTools();
    const usePromise = useTools();
    const [initRes, useRes] = await Promise.all([initPromise, usePromise]);

    expect(useRes).toEqual(initRes);
    fs.unlinkSync(tempToolPath);
  });
});
