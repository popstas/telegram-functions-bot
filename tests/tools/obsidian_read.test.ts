import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import fs from "fs";
import path from "path";
import os from "os";
import type { ConfigChatType } from "../../src/types";

let mod: typeof import("../../src/tools/obsidian_read.ts");

function makeCfg(root: string): ConfigChatType {
  return {
    name: "chat",
    agent_name: "agent",
    completionParams: {},
    chatParams: {},
    toolParams: { obsidian: { root_path: root, out_file: "gpt.md" } },
  } as ConfigChatType;
}

beforeEach(async () => {
  jest.resetModules();
  mod = await import("../../src/tools/obsidian_read.ts");
});

describe("ObsidianReadClient", () => {
  it("reads files and reports missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "obsread-"));
    fs.writeFileSync(path.join(dir, "a.md"), "hello");
    const client = new mod.ObsidianReadClient(makeCfg(dir));
    const res = client.obsidian_read({ file_path: "a.md\nmiss.md" });
    expect(res.content).toContain("=== /a.md ===");
    expect(res.content).toContain("hello");
    expect(res.content).toContain("=== /miss.md ===");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("options_string formats list", () => {
    const client = new mod.ObsidianReadClient(makeCfg("."));
    const str = client.options_string('{"file_path":"a.md\\nb.md"}');
    expect(str).toBe("**Obsidian read:** `a.md, b.md`");
  });

  it("getFilePath splits", () => {
    const client = new mod.ObsidianReadClient(makeCfg("."));
    expect(client.getFilePath({ file_path: "x\ny" })).toEqual(["x", "y"]);
  });

  it("prompt_append lists files", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "obsread-"));
    fs.writeFileSync(path.join(dir, "v.md"), "");
    fs.writeFileSync(path.join(dir, ".h.md"), "");
    const client = new mod.ObsidianReadClient(makeCfg(dir));
    const txt = await client.prompt_append();
    expect(txt).toContain("v.md");
    // hidden files may be included depending on filtering logic
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("call returns instance", () => {
    expect(mod.call(makeCfg("."))).toBeInstanceOf(mod.ObsidianReadClient);
  });
});
