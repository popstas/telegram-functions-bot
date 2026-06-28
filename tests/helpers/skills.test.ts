import { jest, describe, it, beforeEach, afterEach, expect } from "@jest/globals";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import os from "os";
import path from "path";

const mockReadConfig = jest.fn(() => ({ skillsDir: undefined }) as { skillsDir?: string });

type ExecCb = (err: (Error & { code?: number }) | null, stdout: string, stderr: string) => void;
const mockExec = jest.fn();

jest.unstable_mockModule("child_process", () => ({
  __esModule: true,
  ...(jest.requireActual("child_process") as object),
  exec: (cmd: string, opts: unknown, cb: ExecCb) => mockExec(cmd, opts, cb),
}));

jest.unstable_mockModule("../../src/config.ts", () => ({
  readConfig: mockReadConfig,
  useConfig: mockReadConfig,
}));

jest.unstable_mockModule("../../src/helpers.ts", () => ({
  log: jest.fn(),
}));

let loadSkills: typeof import("../../src/helpers/skills.ts").loadSkills;
let parseSkillMarkdown: typeof import("../../src/helpers/skills.ts").parseSkillMarkdown;
let buildSkillTool: typeof import("../../src/helpers/skills.ts").buildSkillTool;
let runSkillCommand: typeof import("../../src/helpers/skills.ts").runSkillCommand;
let loadSkillTools: typeof import("../../src/helpers/skills.ts").loadSkillTools;
let skillToolName: typeof import("../../src/helpers/skills.ts").skillToolName;

let tmpRoot: string;

function makeSkill(base: string, dirName: string, content: string, fileName = "SKILL.md") {
  const dir = path.join(base, dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, fileName), content);
  return dir;
}

describe("skills loader", () => {
  beforeEach(async () => {
    jest.resetModules();
    mockReadConfig.mockReturnValue({ skillsDir: undefined });
    mockExec.mockReset();
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), "skills-test-"));
    ({
      loadSkills,
      parseSkillMarkdown,
      buildSkillTool,
      runSkillCommand,
      loadSkillTools,
      skillToolName,
    } = await import("../../src/helpers/skills.ts"));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe("parseSkillMarkdown", () => {
    it("parses frontmatter and body", () => {
      const res = parseSkillMarkdown(
        `---\nname: hello\ndescription: Say hi\n---\nRun references/hi.py`,
      );
      expect(res).toEqual({
        name: "hello",
        description: "Say hi",
        instructions: "Run references/hi.py",
      });
    });

    it("returns null without frontmatter", () => {
      expect(parseSkillMarkdown("no frontmatter here")).toBeNull();
    });

    it("returns null when name missing", () => {
      expect(parseSkillMarkdown(`---\ndescription: x\n---\nbody`)).toBeNull();
    });

    it("returns null on malformed yaml", () => {
      expect(parseSkillMarkdown(`---\nname: : :\n  bad\n---\nbody`)).toBeNull();
    });
  });

  describe("loadSkills", () => {
    it("loads a valid skill", () => {
      const dir = makeSkill(
        tmpRoot,
        "greet",
        `---\nname: greet\ndescription: Greeting skill\n---\nUse references/hello.py`,
      );
      const skills = loadSkills(tmpRoot);
      expect(skills).toHaveLength(1);
      expect(skills[0]).toEqual({
        name: "greet",
        description: "Greeting skill",
        instructions: "Use references/hello.py",
        dir,
      });
    });

    it("skips a dir missing SKILL.md", () => {
      mkdirSync(path.join(tmpRoot, "not-a-skill"), { recursive: true });
      makeSkill(tmpRoot, "ok", `---\nname: ok\ndescription: d\n---\nbody`);
      const skills = loadSkills(tmpRoot);
      expect(skills.map((s) => s.name)).toEqual(["ok"]);
    });

    it("skips a skill with malformed frontmatter", () => {
      makeSkill(tmpRoot, "bad", `no frontmatter`);
      makeSkill(tmpRoot, "good", `---\nname: good\ndescription: d\n---\nbody`);
      const skills = loadSkills(tmpRoot);
      expect(skills.map((s) => s.name)).toEqual(["good"]);
    });

    it("returns empty array for a missing directory", () => {
      const skills = loadSkills(path.join(tmpRoot, "does-not-exist"));
      expect(skills).toEqual([]);
    });

    it("falls back to config.skillsDir when no arg given", () => {
      makeSkill(tmpRoot, "cfg", `---\nname: cfg\ndescription: d\n---\nbody`);
      mockReadConfig.mockReturnValue({ skillsDir: tmpRoot });
      const skills = loadSkills();
      expect(skills.map((s) => s.name)).toEqual(["cfg"]);
    });
  });

  describe("buildSkillTool", () => {
    const skill = {
      name: "My Skill",
      description: "Greets",
      instructions: "Use references/hi.py",
      dir: "/tmp/my-skill",
    };

    it("exposes a sanitized skill_<name> tool with command schema", () => {
      const tool = buildSkillTool(skill);
      expect(tool.name).toBe("skill_my_skill");
      expect(skillToolName(skill)).toBe("skill_my_skill");
      const mod = tool.module.call({} as never, {} as never);
      const spec = mod.functions.toolSpecs as {
        function: { name: string; description: string; parameters: { required: string[] } };
      };
      expect(spec.function.name).toBe("skill_my_skill");
      expect(spec.function.description).toContain("Greets");
      expect(spec.function.description).toContain("references/hi.py");
      expect(spec.function.parameters.required).toEqual(["command"]);
    });

    it("runs the command with cwd = skill dir and returns stdout", async () => {
      mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: ExecCb) => {
        cb(null, "hello world", "");
      });
      const tool = buildSkillTool(skill);
      const fn = tool.module.call({} as never, {} as never).functions.get("skill_my_skill");
      const res = await fn(JSON.stringify({ command: "python references/hi.py" }));
      expect(res.content).toBe("```\nhello world\n```");
      const opts = mockExec.mock.calls[0][1] as { cwd: string };
      expect(opts.cwd).toBe("/tmp/my-skill");
      expect(mockExec.mock.calls[0][0]).toBe("python references/hi.py");
    });

    it("handles non-zero exit code", async () => {
      mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: ExecCb) => {
        const err = Object.assign(new Error("boom"), { code: 3 });
        cb(err, "", "stderr text");
      });
      const res = await runSkillCommand(skill, "false");
      expect(res.content).toContain("Exit code: 3");
      expect(res.content).toContain("stderr text");
    });

    it("returns Exit code: 0 when no output", async () => {
      mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: ExecCb) => {
        cb(null, "", "");
      });
      const res = await runSkillCommand(skill, "true");
      expect(res.content).toBe("Exit code: 0");
    });

    it("rejects empty command", async () => {
      const tool = buildSkillTool(skill);
      const fn = tool.module.call({} as never, {} as never).functions.get("skill_my_skill");
      const res = await fn(JSON.stringify({ command: "  " }));
      expect(res.content).toBe("No command provided");
      expect(mockExec).not.toHaveBeenCalled();
    });

    it("fails closed on malformed JSON args instead of running raw text", async () => {
      const tool = buildSkillTool(skill);
      const fn = tool.module.call({} as never, {} as never).functions.get("skill_my_skill");
      const res = await fn("rm -rf /");
      expect(res.content).toBe("No command provided");
      expect(mockExec).not.toHaveBeenCalled();
    });

    it("truncates output longer than the cap", async () => {
      mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: ExecCb) => {
        cb(null, "x".repeat(9000), "");
      });
      const res = await runSkillCommand(skill, "spew");
      expect(res.content).toContain("…(truncated)");
      // 8000 chars + fences + truncation marker, but well under the raw 9000.
      expect(res.content.length).toBeLessThan(9000);
    });

    it("formats options_string with the command", () => {
      const tool = buildSkillTool(skill);
      const mod = tool.module.call({} as never, {} as never);
      const str = mod.options_string?.(JSON.stringify({ command: "ls" }));
      expect(str).toContain("skill_my_skill");
      expect(str).toContain("ls");
    });
  });

  describe("loadSkillTools", () => {
    it("builds tools for discovered skills", () => {
      makeSkill(tmpRoot, "greet", `---\nname: greet\ndescription: d\n---\nbody`);
      const tools = loadSkillTools(tmpRoot);
      expect(tools.map((t) => t.name)).toEqual(["skill_greet"]);
    });

    it("returns empty array when no skills found", () => {
      const tools = loadSkillTools(path.join(tmpRoot, "missing"));
      expect(tools).toEqual([]);
    });
  });
});
