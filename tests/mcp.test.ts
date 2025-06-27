import { jest, describe, it, beforeEach, expect } from "@jest/globals";

let callMcp: typeof import("../src/mcp.ts").callMcp;
let __test: typeof import("../src/mcp.ts").__test;

beforeEach(async () => {
  jest.resetModules();
  ({ callMcp, __test } = await import("../src/mcp.ts"));
  __test.resetClients();
});

describe("callMcp", () => {
  it("returns message when client missing", async () => {
    const res = await callMcp("model", "tool", "{}");
    expect(res).toEqual({ content: "MCP client not initialized: model" });
  });

  it("calls tool and returns string result", async () => {
    const client = {
      callTool: jest.fn().mockResolvedValue({ content: "ok" }),
    } as unknown as {
      callTool: jest.Mock<Promise<{ content: string }>, [unknown]>;
    };
    __test.setClient("m1", client);
    const res = await callMcp("m1", "foo", "{}");
    expect(client.callTool).toHaveBeenCalledWith({
      name: "foo",
      arguments: {},
    });
    expect(res).toEqual({ content: "ok" });
  });

  it("stringifies non string result", async () => {
    const client = {
      callTool: jest.fn().mockResolvedValue({ content: { a: 1 } }),
    } as unknown as {
      callTool: jest.Mock<Promise<{ content: unknown }>, [unknown]>;
    };
    __test.setClient("m2", client);
    const res = await callMcp("m2", "foo", "{}");
    expect(res).toEqual({ content: JSON.stringify({ a: 1 }) });
  });

  it("handles errors", async () => {
    const client = {
      callTool: jest.fn().mockRejectedValue(new Error("bad")),
    } as unknown as { callTool: jest.Mock<Promise<never>, [unknown]> };
    __test.setClient("m3", client);
    const res = await callMcp("m3", "foo", "{}");
    expect(res).toEqual({ content: "MCP call error: bad" });
  });
});
