import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { AppSettings } from "../shared/types.js";

export function runWsl(args: string[], opts?: { timeoutMs?: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("wsl.exe", args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`wsl timed out: ${args.join(" ")}`));
    }, opts?.timeoutMs ?? 15000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `wsl exited with code ${code}`));
      }
    });
  });
}

export async function listDistros(): Promise<string[]> {
  try {
    const output = await runWsl(["-l", "-q"]);
    return output
      .replace(/\0/g, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function readOpenClawConfig(settings: AppSettings): Promise<Record<string, unknown> | null> {
  try {
    const output = await runWsl(["-d", settings.wslDistro, "--", "sh", "-lc", "cat ~/.openclaw/openclaw.json"], {
      timeoutMs: 10000,
    });
    return JSON.parse(output) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function detectAuth(settings: AppSettings): Promise<Partial<AppSettings>> {
  const config = await readOpenClawConfig(settings);
  if (!config) {
    return {};
  }
  const gateway = asRecord(config.gateway);
  const auth = asRecord(gateway.auth);
  const mode = stringValue(auth.mode) ?? stringValue(gateway.authMode);
  const token = stringValue(auth.token) ?? stringValue(gateway.token);
  const password = stringValue(auth.password) ?? stringValue(gateway.password);
  const port = numberValue(gateway.port) ?? settings.port;
  const host = stringValue(gateway.host) ?? settings.host;
  return {
    ...(mode === "token" || token ? { authMode: "token" as const, token } : {}),
    ...(mode === "password" || password ? { authMode: "password" as const, password } : {}),
    host,
    port,
    gatewayUrl: `ws://${host}:${port}`,
  };
}

export async function resolveWslIp(settings: AppSettings): Promise<string | null> {
  try {
    const output = await runWsl(["-d", settings.wslDistro, "--", "hostname", "-I"], { timeoutMs: 5000 });
    return output.split(/\s+/).find((part) => /^\d+\.\d+\.\d+\.\d+$/.test(part)) ?? null;
  } catch {
    return null;
  }
}

export function windowsPathToWsl(windowsPath: string): string {
  const normalized = path.resolve(windowsPath);
  const match = normalized.match(/^([A-Za-z]):\\(.*)$/);
  if (!match) {
    return normalized.replaceAll("\\", "/");
  }
  return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll("\\", "/")}`;
}

export async function orientOpenClaw(settings: AppSettings, windowsPaths: string[]): Promise<void> {
  const startMarker = "<!-- OPENCLAW_DESKTOP_FILE_ACCESS_START -->";
  const endMarker = "<!-- OPENCLAW_DESKTOP_FILE_ACCESS_END -->";
  const lines = [
    startMarker,
    "## OpenClaw Desktop Windows File Access",
    "When the user asks for Windows files, use WSL mount paths. Windows drives are mounted as `/mnt/c`, `/mnt/d`, etc.",
    "If a user mentions a file, folder, or partial path that appears under one of these locations, use filesystem tools directly instead of asking them to attach it.",
    "Allowed Windows locations:",
    ...windowsPaths.map((item) => `- ${item} -> ${windowsPathToWsl(item)}`),
    endMarker,
  ];
  const escaped = lines.join("\n").replaceAll("'", "'\"'\"'");
  await runWsl([
    "-d",
    settings.wslDistro,
    "--",
    "sh",
    "-lc",
    `mkdir -p ~/.openclaw && touch ~/.openclaw/AGENTS.md && awk 'BEGIN{skip=0} /${startMarker}/{skip=1; next} /${endMarker}/{skip=0; next} skip==0{print}' ~/.openclaw/AGENTS.md > ~/.openclaw/AGENTS.md.tmp && printf '\\n%s\\n' '${escaped}' >> ~/.openclaw/AGENTS.md.tmp && mv ~/.openclaw/AGENTS.md.tmp ~/.openclaw/AGENTS.md`,
  ]);
}

export async function fileInfoFromPaths(paths: string[]) {
  return await Promise.all(
    paths.map(async (filePath) => {
      const stat = await fs.stat(filePath);
      return {
        id: `${filePath}-${stat.mtimeMs}`,
        name: path.basename(filePath),
        type: stat.isDirectory() ? "folder" : path.extname(filePath).replace(".", "") || "file",
        windowsPath: filePath,
        wslPath: windowsPathToWsl(filePath),
      };
    }),
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
