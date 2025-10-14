import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { mkdtempSync } from "node:fs";
import { LogTailer, parseLogLine, createDefaultLogTailer } from "../../electron/logTail.ts";

const TIMESTAMP = "2024-01-01 10:00:00";

describe("parseLogLine", () => {
  it("extracts metadata from formatted log lines", () => {
    const entry = parseLogLine("messages", `[${TIMESTAMP}] [WARN] chat message`);
    expect(entry.timestamp).toBe(TIMESTAMP);
    expect(entry.level).toBe("warn");
    expect(entry.message).toBe("chat message");
    expect(entry.source).toBe("messages");
  });

  it("falls back to defaults when metadata missing", () => {
    const entry = parseLogLine("messages", "plain line without timestamp");
    expect(entry.timestamp).toBeUndefined();
    expect(entry.level).toBe("info");
    expect(entry.message).toBe("plain line without timestamp");
  });
});

describe("LogTailer", () => {
  let tempDir: string;
  let files: Record<"messages", string>;
  let tailer: LogTailer;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "tgbot-logs-"));
    files = {
      messages: path.join(tempDir, "messages.log"),
    };
  });

  afterEach(() => {
    tailer?.stop();
    return fs.rm(tempDir, { recursive: true, force: true });
  });

  it("emits existing lines on startup", async () => {
    await fs.writeFile(files.messages, `[${TIMESTAMP}] [INFO] hello world\n`);

    const seen: string[] = [];
    tailer = new LogTailer(files);
    tailer.on("log", (entry) => {
      seen.push(`${entry.source}:${entry.message}`);
    });

    await tailer.start();

    expect(seen).toEqual(["messages:hello world"]);
  });

  it("watches for appended lines", async () => {
    await fs.writeFile(files.messages, "");

    const received: string[] = [];
    tailer = new LogTailer(files, { followExisting: false });
    tailer.on("log", (entry) => {
      received.push(`${entry.source}:${entry.message}`);
    });

    await tailer.start();

    await fs.appendFile(files.messages, `[${TIMESTAMP}] new message\n`);
    await tailer.refresh("messages");

    const expectedEntries = ["messages:new message"];
    for (let i = 0; i < 20; i++) {
      if (expectedEntries.every((line) => received.includes(line))) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(received).toEqual(expect.arrayContaining(expectedEntries));
  });

  it("default tailer emits only new message lines", async () => {
    const baseDir = path.join(tempDir, "logs");
    await fs.mkdir(baseDir, { recursive: true });
    const messagesFile = path.join(baseDir, "messages.log");
    await fs.writeFile(messagesFile, `[${TIMESTAMP}] [INFO] old line\n`);

    const received: string[] = [];
    tailer = createDefaultLogTailer(baseDir);
    tailer.on("log", (entry) => {
      received.push(`${entry.source}:${entry.message}`);
    });

    await tailer.start();
    expect(received).toHaveLength(0);

    await fs.appendFile(messagesFile, `[${TIMESTAMP}] [INFO] fresh line\n`);
    await tailer.refresh("messages");

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(new Set(received)).toEqual(new Set(["messages:fresh line"]));
  });
});
