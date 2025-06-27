import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import fs from "fs";
import path from "path";
import os from "os";
import type { ConfigChatType } from "../../src/types";

let mod: typeof import("../../src/tools/obsidian_write.ts");

function makeCfg(root: string | undefined, outFile = "gpt.md"): ConfigChatType {
  return {
    name: "chat",
    agent_name: "agent",
    completionParams: {},
    chatParams: {},
    toolParams: root
      ? { obsidian: { root_path: root, out_file: outFile } }
      : {},
  } as ConfigChatType;
}

beforeEach(async () => {
  jest.resetModules();
  mod = await import("../../src/tools/obsidian_write.ts");
});

describe("ObsidianWriteClient", () => {
  it("appends markdown to default file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "obswrite-"));
    fs.writeFileSync(path.join(dir, "gpt.md"), "");
    const client = new mod.ObsidianWriteClient(makeCfg(dir, "note.md"));
    const res = client.obsidian_write({ markdown: "hi" });
    const content = fs.readFileSync(path.join(dir, "gpt.md"), "utf8");
    expect(content).toContain("hi");
    expect(res.content).toBe("Appended to gpt.md");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns message when root_path missing", () => {
    const client = new mod.ObsidianWriteClient(makeCfg(undefined));
    const res = client.obsidian_write({ markdown: "x" });
    expect(res.content).toBe("No root_path in config");
  });

  it("options_string formats markdown", () => {
    const client = new mod.ObsidianWriteClient(makeCfg("."));
    expect(client.options_string('{"markdown":"# H"}')).toBe(
      "**Write to Obsidian:**`\n```md\n# H\n```",
    );
  });

  it("call returns instance", () => {
    expect(mod.call(makeCfg("."))).toBeInstanceOf(mod.ObsidianWriteClient);
  });
});
