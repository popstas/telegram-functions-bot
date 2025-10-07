import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { mkdtempSync } from "node:fs";
import { LogTailer, parseLogLine } from "../../electron/logTail.ts";

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
    const entry = parseLogLine("http", "plain line without timestamp");
    expect(entry.timestamp).toBeUndefined();
    expect(entry.level).toBe("info");
    expect(entry.message).toBe("plain line without timestamp");
  });
});

describe("LogTailer", () => {
  let tempDir: string;
  let files: Record<"messages" | "http" | "mqtt", string>;
  let tailer: LogTailer;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "tgbot-logs-"));
    files = {
      messages: path.join(tempDir, "messages.log"),
      http: path.join(tempDir, "http.log"),
      mqtt: path.join(tempDir, "mqtt.log"),
    };
  });

  afterEach(() => {
    tailer?.stop();
    return fs.rm(tempDir, { recursive: true, force: true });
  });

  it("emits existing lines on startup", async () => {
    await fs.writeFile(files.messages, `[${TIMESTAMP}] [INFO] hello world\n`);
    await fs.writeFile(files.http, `[${TIMESTAMP}] request accepted\n`);
    await fs.writeFile(files.mqtt, `[${TIMESTAMP}] mqtt event\n`);

    const seen: string[] = [];
    tailer = new LogTailer(files);
    tailer.on("log", (entry) => {
      seen.push(`${entry.source}:${entry.message}`);
    });

    await tailer.start();

    expect(seen).toHaveLength(3);
    expect(seen).toEqual(
      expect.arrayContaining(["messages:hello world", "http:request accepted", "mqtt:mqtt event"]),
    );
  });

  it("watches for appended lines", async () => {
    await fs.writeFile(files.messages, "");
    await fs.writeFile(files.http, "");
    await fs.writeFile(files.mqtt, "");

    const received: string[] = [];
    tailer = new LogTailer(files, { followExisting: false });
    tailer.on("log", (entry) => {
      received.push(`${entry.source}:${entry.message}`);
    });

    await tailer.start();

    await fs.appendFile(files.messages, `[${TIMESTAMP}] new message\n`);
    await tailer.refresh("messages");
    await fs.appendFile(files.http, `[${TIMESTAMP}] [ERROR] http failed\n`);
    await tailer.refresh("http");

    const expectedEntries = ["messages:new message", "http:http failed"];
    for (let i = 0; i < 20; i++) {
      if (expectedEntries.every((line) => received.includes(line))) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(received).toEqual(expect.arrayContaining(expectedEntries));
  });
});
