import { app, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  ts: string;
  level: LogLevel;
  scope: string;
  message: string;
  data?: unknown;
};

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_RING = 1000;

class Logger extends EventEmitter {
  private logDir: string | null = null;
  private logFile: string | null = null;
  private ring: LogEntry[] = [];
  private inited = false;

  init(): void {
    if (this.inited) {
      return;
    }
    const userData = safeUserData();
    this.logDir = path.join(userData, "logs");
    this.logFile = path.join(this.logDir, "openclaw-desktop.log");
    try {
      fs.mkdirSync(this.logDir, { recursive: true });
      this.rotateIfNeeded();
    } catch {}
    this.inited = true;
    this.info("logger", "logger initialized", {
      logFile: this.logFile,
      pid: process.pid,
      version: app.getVersion?.(),
      platform: process.platform,
    });
  }

  getLogFile(): string {
    this.init();
    return this.logFile ?? "";
  }

  getLogDir(): string {
    this.init();
    return this.logDir ?? "";
  }

  openLogDir(): void {
    const dir = this.getLogDir();
    if (dir) {
      void shell.openPath(dir);
    }
  }

  tail(limit = 400): LogEntry[] {
    this.init();
    if (this.ring.length >= limit) {
      return this.ring.slice(-limit);
    }
    // Read file as fallback for early entries after restart.
    const file = this.logFile;
    if (!file || !fs.existsSync(file)) {
      return [...this.ring];
    }
    try {
      const text = fs.readFileSync(file, "utf8");
      const lines = text.split(/\r?\n/).filter(Boolean);
      const slice = lines.slice(-limit);
      const entries: LogEntry[] = [];
      for (const line of slice) {
        try {
          entries.push(JSON.parse(line) as LogEntry);
        } catch {
          entries.push({ ts: new Date().toISOString(), level: "info", scope: "raw", message: line });
        }
      }
      return entries;
    } catch {
      return [...this.ring];
    }
  }

  debug(scope: string, message: string, data?: unknown): void {
    this.write("debug", scope, message, data);
  }
  info(scope: string, message: string, data?: unknown): void {
    this.write("info", scope, message, data);
  }
  warn(scope: string, message: string, data?: unknown): void {
    this.write("warn", scope, message, data);
  }
  error(scope: string, message: string, data?: unknown): void {
    this.write("error", scope, message, data);
  }

  attachChild(scope: string, child: ChildProcessWithoutNullStreams | null | undefined): void {
    if (!child) {
      return;
    }
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      for (const line of splitLines(chunk)) {
        this.info(scope, `[stdout] ${line}`);
      }
    });
    child.stderr?.on("data", (chunk: string) => {
      for (const line of splitLines(chunk)) {
        this.warn(scope, `[stderr] ${line}`);
      }
    });
    child.on("exit", (code, signal) => {
      this.info(scope, `process exit`, { code, signal });
    });
    child.on("error", (error) => {
      this.error(scope, `process error`, { message: error.message });
    });
  }

  private write(level: LogLevel, scope: string, message: string, data?: unknown): void {
    this.init();
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      scope,
      message,
      data,
    };
    this.ring.push(entry);
    if (this.ring.length > MAX_RING) {
      this.ring.splice(0, this.ring.length - MAX_RING);
    }
    const line = JSON.stringify(entry) + "\n";
    try {
      if (this.logFile) {
        fs.appendFileSync(this.logFile, line);
        this.rotateIfNeeded();
      }
    } catch {}
    // Mirror to stderr so dev terminal sees it too.
    try {
      process.stderr.write(`[${entry.ts}] ${level.toUpperCase()} ${scope}: ${message}${data ? " " + safeJson(data) : ""}\n`);
    } catch {}
    this.emit("entry", entry);
  }

  private rotateIfNeeded(): void {
    if (!this.logFile) {
      return;
    }
    try {
      const stat = fs.statSync(this.logFile);
      if (stat.size > MAX_BYTES) {
        const rotated = `${this.logFile}.1`;
        try {
          fs.rmSync(rotated, { force: true });
        } catch {}
        fs.renameSync(this.logFile, rotated);
      }
    } catch {
      // file may not exist yet
    }
  }
}

function safeUserData(): string {
  try {
    return app.getPath("userData");
  } catch {
    return path.join(process.cwd(), ".openclaw-desktop");
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function splitLines(chunk: string): string[] {
  return chunk
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export const logger = new Logger();
