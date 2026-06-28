import { jest, describe, it, beforeEach, afterEach, expect } from "@jest/globals";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "fs";
import os from "os";
import path from "path";

const mockReadConfig = jest.fn(() => ({ skillsDir: undefined }) as { skillsDir?: string });

jest.unstable_mockModule("../../src/config.ts", () => ({
  readConfig: mockReadConfig,
  useConfig: mockReadConfig,
}));

jest.unstable_mockModule("../../src/helpers.ts", () => ({
  log: jest.fn(),
}));

let loadSkills: typeof import("../../src/helpers/skills.ts").loadSkills;
let parseSkillMarkdown: typeof import("../../src/helpers/skills.ts").parseSkillMarkdown;

let tmpRoot: string;

function makeSkill(
  base: string,
  dirName: string,
  content: string,
  fileName = "SKILL.md",
) {
  const dir = path.join(base, dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, fileName), content);
  return dir;
}

describe("skills loader", () => {
  beforeEach(async () => {
    jest.resetModules();
    mockReadConfig.mockReturnValue({ skillsDir: undefined });
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), "skills-test-"));
    ({ loadSkills, parseSkillMarkdown } = await import(
      "../../src/helpers/skills.ts"
    ));
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
      makeSkill(
        tmpRoot,
        "ok",
        `---\nname: ok\ndescription: d\n---\nbody`,
      );
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
      makeSkill(
        tmpRoot,
        "cfg",
        `---\nname: cfg\ndescription: d\n---\nbody`,
      );
      mockReadConfig.mockReturnValue({ skillsDir: tmpRoot });
      const skills = loadSkills();
      expect(skills.map((s) => s.name)).toEqual(["cfg"]);
    });
  });
});
