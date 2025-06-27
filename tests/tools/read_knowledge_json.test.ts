import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import fs from "fs";
import path from "path";
import os from "os";
import type { ConfigChatType } from "../../src/types";

jest.unstable_mockModule("../../src/config.ts", () => ({
  readConfig: () => ({ auth: {}, chats: [] }),
}));

let mod: typeof import("../../src/tools/read_knowledge_json.ts");

function cfg(opts: Record<string, unknown>): ConfigChatType {
  return {
    name: "c",
    agent_name: "a",
    completionParams: {},
    chatParams: {},
    toolParams: { knowledge_json: opts },
  } as ConfigChatType;
}

beforeEach(async () => {
  jest.resetModules();
  mod = await import("../../src/tools/read_knowledge_json.ts");
});

describe("KnowledgeJsonClient", () => {
  it("reads local json and caches", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "json-"));
    const file = path.join(dir, "data.json");
    fs.writeFileSync(file, JSON.stringify([{ title: "T", text: "X" }]));
    const client = new mod.KnowledgeJsonClient(
      cfg({ jsonPath: file, titleCol: "title", textCol: "text" }),
    );
    const r1 = await client.read_knowledge_json({ title: "T" });
    fs.rmSync(file); // remove file to ensure cache used
    const r2 = await client.read_knowledge_json({ title: "T" });
    expect(r1.content).toBe("X");
    expect(r2.content).toBe("X");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads from url and caches", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue([{ title: "A", text: "B" }]),
      ok: true,
    });
    (global as any).fetch = fetchMock;
    const client = new mod.KnowledgeJsonClient(
      cfg({
        jsonUrl: "http://x",
        titleCol: "title",
        textCol: "text",
        cacheTime: 1,
      }),
    );
    await client.read_knowledge_json({ title: "A" });
    await client.read_knowledge_json({ title: "A" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("options_string formats title", () => {
    const client = new mod.KnowledgeJsonClient(cfg({ jsonPath: "p" }));
    expect(client.options_string('{"title":"Z"}')).toBe("**JSON data:** `Z`");
  });

  it("prompt_append lists titles", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "json-"));
    const file = path.join(dir, "d.json");
    fs.writeFileSync(
      file,
      JSON.stringify([
        { title: "T1", text: "A" },
        { title: "T2", text: "B" },
      ]),
    );
    const client = new mod.KnowledgeJsonClient(
      cfg({ jsonPath: file, titleCol: "title", textCol: "text" }),
    );
    const txt = await client.prompt_append();
    expect(txt).toContain("- T1");
    expect(txt).toContain("- T2");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("call returns instance", () => {
    expect(mod.call(cfg({ jsonPath: "f" }))).toBeInstanceOf(
      mod.KnowledgeJsonClient,
    );
  });
});
