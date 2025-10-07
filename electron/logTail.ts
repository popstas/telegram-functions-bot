import { EventEmitter } from "node:events";
import { promises as fsPromises, watch, FSWatcher } from "node:fs";
import path from "node:path";

export type LogSource = "messages" | "http" | "mqtt";
export type LogLevel = "debug" | "verbose" | "info" | "warn" | "error";

export interface LogEntry {
  source: LogSource;
  raw: string;
  message: string;
  timestamp?: string;
  level: LogLevel;
}

export interface LogTailerOptions {
  followExisting?: boolean;
}

type WatcherMap = Map<LogSource, FSWatcher>;

type ListenerSignature = {
  log: (entry: LogEntry) => void;
  error: (error: Error) => void;
};

export class LogTailer extends EventEmitter {
  private readonly offsets = new Map<LogSource, number>();
  private readonly watchers: WatcherMap = new Map();
  private readonly absolutePaths = new Map<LogSource, string>();
  private readonly initialized = new Set<LogSource>();
  private running = false;

  constructor(
    private readonly files: Record<LogSource, string>,
    private readonly options: LogTailerOptions = {},
  ) {
    super();
  }

  override on<Event extends keyof ListenerSignature>(
    event: Event,
    listener: ListenerSignature[Event],
  ): this;
  override on(event: string, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  override off<Event extends keyof ListenerSignature>(
    event: Event,
    listener: ListenerSignature[Event],
  ): this;
  override off(event: string, listener: (...args: unknown[]) => void): this {
    return super.off(event, listener);
  }

  async start() {
    if (this.running) return;
    this.running = true;
    await Promise.all(
      (Object.keys(this.files) as LogSource[]).map(async (source) => {
        const absolute = path.resolve(this.files[source]);
        this.absolutePaths.set(source, absolute);
        this.offsets.set(source, 0);
        const readExisting = this.options.followExisting !== false;
        await this.readUpdates(source, readExisting);
        this.initialized.add(source);
        await this.attachWatcher(source, absolute);
      }),
    );
  }

  stop() {
    this.watchers.forEach((watcher) => watcher.close());
    this.watchers.clear();
    this.offsets.clear();
    this.running = false;
  }

  async refresh(source?: LogSource) {
    const targets = source ? [source] : (Object.keys(this.files) as LogSource[]);
    for (const target of targets) {
      await this.readUpdates(target);
    }
  }

  private async attachWatcher(source: LogSource, absolute: string) {
    const dir = path.dirname(absolute);
    const fileName = path.basename(absolute);
    try {
      await fsPromises.access(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      this.emit("error", error as Error);
      return;
    }

    const watcher = watch(dir, { persistent: false }, async (eventType, changed) => {
      if (!changed || changed.toString() !== fileName) {
        return;
      }
      const reset = eventType === "rename";
      await this.readUpdates(source, reset);
    });
    this.watchers.set(source, watcher);
  }

  private async readUpdates(source: LogSource, reset = false) {
    const file = this.absolutePaths.get(source);
    if (!file) return;

    try {
      const stat = await fsPromises.stat(file);
      const previous = this.offsets.get(source) ?? 0;
      let start = previous;
      if (reset || stat.size < previous) {
        start = 0;
      }
      const skipExisting =
        this.options.followExisting === false &&
        previous === 0 &&
        !reset &&
        !this.initialized.has(source);
      if (skipExisting) {
        start = stat.size;
      }
      const data = await fsPromises.readFile(file, "utf8");
      const slice = data.slice(start);
      this.offsets.set(source, stat.size);
      this.enqueueLines(source, slice);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        this.offsets.set(source, 0);
        return;
      }
      this.emit("error", err);
    }
  }

  private enqueueLines(source: LogSource, chunk: string) {
    if (!chunk) return;
    const lines = chunk.split(/\r?\n/).filter((line) => line.trim().length > 0);
    for (const raw of lines) {
      const entry = parseLogLine(source, raw);
      this.emit("log", entry);
    }
  }
}

const LEVEL_REGEX = /\[(DEBUG|VERBOSE|INFO|WARN|ERROR)\]\s*/i;
const TIMESTAMP_REGEX = /^\s*\[(?<timestamp>[^\]]+)\]\s*/;

export function parseLogLine(source: LogSource, raw: string): LogEntry {
  const entry: LogEntry = {
    source,
    raw,
    message: raw,
    level: "info",
  };

  const timestampMatch = raw.match(TIMESTAMP_REGEX);
  let remainder = raw;
  if (timestampMatch?.groups?.timestamp) {
    entry.timestamp = timestampMatch.groups.timestamp;
    remainder = remainder.slice(timestampMatch[0].length);
  }

  const levelMatch = remainder.match(LEVEL_REGEX);
  if (levelMatch) {
    entry.level = levelMatch[1].toLowerCase() as LogLevel;
    remainder = remainder.replace(levelMatch[0], "");
  }

  entry.message = remainder.trim();
  return entry;
}

export function createDefaultLogTailer(baseDir = "data") {
  const files: Record<LogSource, string> = {
    messages: path.join(baseDir, "messages.log"),
    http: path.join(baseDir, "http.log"),
    mqtt: path.join(baseDir, "mqtt.log"),
  };
  return new LogTailer(files);
}
