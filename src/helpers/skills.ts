import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import path from "path";
import yaml from "js-yaml";
import { exec } from "child_process";
import { log } from "../helpers.ts";
import { readConfig } from "../config.ts";
import type { ChatToolType, ModuleType, SkillType, ToolResponse } from "../types.ts";

const SKILL_FILE = "SKILL.md";

/** Max time a skill command may run before being killed. */
const SKILL_EXEC_TIMEOUT_MS = 60_000;
/** Max bytes captured from a skill command's stdout/stderr. */
const SKILL_EXEC_MAX_BUFFER = 1024 * 1024;
/** Max characters of output returned to the model. */
const SKILL_OUTPUT_MAX_CHARS = 8000;

/**
 * Sanitize a skill name into the `[a-z0-9_]` charset used for the tool name.
 */
export function sanitizeSkillName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** The tool name exposed for a skill, e.g. `skill_greet`. */
export function skillToolName(skill: SkillType): string {
  return `skill_${sanitizeSkillName(skill.name)}`;
}

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
    description: typeof fm.description === "string" ? fm.description.trim() : "",
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

/**
 * Run a shell command inside the skill directory so `references/*` scripts are
 * reachable. Mirrors `src/tools/powershell.ts`: returns fenced stdout, or an
 * `Exit code: N` message on failure. Never rejects.
 */
export function runSkillCommand(skill: SkillType, command: string): Promise<ToolResponse> {
  return new Promise<ToolResponse>((resolve) => {
    exec(
      command,
      {
        cwd: skill.dir,
        timeout: SKILL_EXEC_TIMEOUT_MS,
        maxBuffer: SKILL_EXEC_MAX_BUFFER,
      },
      (error, stdout, stderr) => {
        const out = (stdout || "").toString();
        const err = (stderr || "").toString();
        let body = out;
        if (err) body += (body ? "\n" : "") + err;
        if (body.length > SKILL_OUTPUT_MAX_CHARS) {
          body = body.slice(0, SKILL_OUTPUT_MAX_CHARS) + "\n…(truncated)";
        }

        if (error) {
          const code = typeof error.code === "number" ? error.code : 1;
          const content = body
            ? "```\n" + body + "\n```\n" + `Exit code: ${code}`
            : `Exit code: ${code}`;
          resolve({ content });
          return;
        }

        if (!body) {
          resolve({ content: "Exit code: 0" });
          return;
        }
        resolve({ content: "```\n" + body + "\n```" });
      },
    );
  });
}

/**
 * Build a callable `skill_<name>` tool from a discovered skill. The tool takes a
 * single `command` string which is executed with `cwd` = the skill directory.
 * The description carries the SKILL.md instructions so the model knows which
 * `references/*` scripts exist.
 */
export function buildSkillTool(skill: SkillType): ChatToolType {
  const name = skillToolName(skill);
  const description = [skill.description, skill.instructions].filter(Boolean).join("\n\n");

  const module: ChatToolType["module"] = {
    description,
    call: (): ModuleType => ({
      functions: {
        get: () => (args: string) => {
          let command = "";
          try {
            const parsed = JSON.parse(args) as { command?: string };
            command = typeof parsed.command === "string" ? parsed.command : "";
          } catch {
            // Malformed tool-call args: fail closed rather than running raw text as a shell command.
            command = "";
          }
          if (!command.trim()) {
            return Promise.resolve({ content: "No command provided" });
          }
          return runSkillCommand(skill, command);
        },
        toolSpecs: {
          type: "function" as const,
          function: {
            name,
            description: description || `Run the ${skill.name} skill`,
            parameters: {
              type: "object",
              properties: {
                command: {
                  type: "string",
                  description: `Shell command to run inside the ${skill.name} skill directory`,
                },
              },
              required: ["command"],
            },
          },
        },
      },
      options_string: (args: string) => {
        try {
          const { command } = JSON.parse(args) as { command?: string };
          if (!command) return args;
          return `\`${name}:\`\n\`\`\`\n${command}\n\`\`\``;
        } catch {
          return args;
        }
      },
    }),
  };

  return { name, module };
}

/**
 * Load all skills and build their `skill_<name>` tools. Never throws.
 */
export function loadSkillTools(skillsDir?: string): ChatToolType[] {
  try {
    return loadSkills(skillsDir).map(buildSkillTool);
  } catch (e) {
    log({
      msg: `Failed to load skill tools: ${(e as Error).message}`,
      logLevel: "warn",
    });
    return [];
  }
}
