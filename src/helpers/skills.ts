import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import path from "path";
import yaml from "js-yaml";
import { log } from "../helpers.ts";
import { readConfig } from "../config.ts";
import type { SkillType } from "../types.ts";

const SKILL_FILE = "SKILL.md";

/**
 * Parse the frontmatter + body of a SKILL.md file.
 * Returns null when there is no valid YAML frontmatter block with a `name`.
 */
export function parseSkillMarkdown(
  content: string,
): { name: string; description: string; instructions: string } | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;

  let frontmatter: unknown;
  try {
    frontmatter = yaml.load(match[1]);
  } catch {
    return null;
  }

  if (!frontmatter || typeof frontmatter !== "object") return null;
  const fm = frontmatter as Record<string, unknown>;
  if (typeof fm.name !== "string" || !fm.name.trim()) return null;

  return {
    name: fm.name.trim(),
    description:
      typeof fm.description === "string" ? fm.description.trim() : "",
    instructions: (match[2] || "").trim(),
  };
}

/**
 * Scan a skills directory and return one SkillType per subdirectory that
 * contains a valid SKILL.md. Never throws: missing dir / missing SKILL.md /
 * malformed frontmatter are skipped with a warning.
 */
export function loadSkills(skillsDir?: string): SkillType[] {
  let dir = skillsDir;
  if (!dir) {
    try {
      dir = readConfig().skillsDir;
    } catch {
      dir = undefined;
    }
  }
  if (!dir) dir = "skills";

  const baseDir = path.resolve(dir);
  if (!existsSync(baseDir)) {
    log({
      msg: `Skills directory not found: ${baseDir}`,
      logLevel: "debug",
    });
    return [];
  }

  let entries: string[];
  try {
    entries = readdirSync(baseDir);
  } catch (e) {
    log({
      msg: `Failed to read skills directory ${baseDir}: ${(e as Error).message}`,
      logLevel: "warn",
    });
    return [];
  }

  const skills: SkillType[] = [];
  for (const entry of entries) {
    const skillDir = path.join(baseDir, entry);
    let isDir = false;
    try {
      isDir = statSync(skillDir).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) continue;

    const skillFile = path.join(skillDir, SKILL_FILE);
    if (!existsSync(skillFile)) continue;

    let content: string;
    try {
      content = readFileSync(skillFile, "utf8");
    } catch (e) {
      log({
        msg: `Failed to read ${skillFile}: ${(e as Error).message}`,
        logLevel: "warn",
      });
      continue;
    }

    const parsed = parseSkillMarkdown(content);
    if (!parsed) {
      log({
        msg: `Skipping skill ${entry}: invalid or missing frontmatter in ${SKILL_FILE}`,
        logLevel: "warn",
      });
      continue;
    }

    skills.push({
      name: parsed.name,
      description: parsed.description,
      instructions: parsed.instructions,
      dir: skillDir,
    });
  }

  return skills;
}
