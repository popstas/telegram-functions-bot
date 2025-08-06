import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { ToolResponse } from "../../src/types.ts";

let mod: typeof import("../../src/tools/javascript_interpreter.ts");

beforeEach(async () => {
  jest.resetModules();
  mod = await import("../../src/tools/javascript_interpreter.ts");
});

describe("JavascriptInterpreterClient", () => {
  it("executes code and returns result", async () => {
    const client = new mod.JavascriptInterpreterClient();
    const res = await client.javascript_interpreter({ code: "1+2" });
    expect(res).toEqual({ content: "3" } as ToolResponse);
  });

  it("returns error string on exception", async () => {
    const client = new mod.JavascriptInterpreterClient();
    const res = await client.javascript_interpreter({
      code: "throw new Error('x')",
    });
    expect(res.content).toContain("Error: Unknown error");
  });

  it("options_string formats code", () => {
    const client = new mod.JavascriptInterpreterClient();
    const formatted = client.options_string('{"code":"2+2"}');
    expect(formatted).toBe("`Javascript:`\n```js\n2+2\n```");
  });

  it("call returns instance", () => {
    const client = mod.call();
    expect(client).toBeInstanceOf(mod.JavascriptInterpreterClient);
  });
});
