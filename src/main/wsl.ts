import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "./logger.js";
import type { AppSettings } from "../shared/types.js";

export function runWsl(args: string[], opts?: { timeoutMs?: number; logScope?: string }): Promise<string> {
  const scope = opts?.logScope ?? "wsl";
  const summary = summarizeArgs(args);
  const startedAt = Date.now();
  logger.debug(scope, `wsl exec: ${summary}`);
  return new Promise((resolve, reject) => {
    const child = spawn("wsl.exe", args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timeoutMs = opts?.timeoutMs ?? 15000;
    const timeout = setTimeout(() => {
      child.kill();
      logger.warn(scope, `wsl timed out after ${timeoutMs}ms: ${summary}`);
      reject(new Error(`wsl timed out: ${summary}`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      logger.error(scope, `wsl spawn error: ${error.message}`, { summary });
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const elapsed = Date.now() - startedAt;
      if (code === 0) {
        logger.debug(scope, `wsl ok in ${elapsed}ms: ${summary}`, { stdoutBytes: stdout.length });
        resolve(stdout.trim());
      } else {
        const err = stderr.trim() || `wsl exited with code ${code}`;
        logger.warn(scope, `wsl failed (code=${code}) in ${elapsed}ms: ${summary}`, { stderr: err.slice(0, 1000) });
        reject(new Error(err));
      }
    });
  });
}

function summarizeArgs(args: string[]): string {
  const joined = args.join(" ");
  return joined.length > 200 ? `${joined.slice(0, 200)}…` : joined;
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
    "If a user mentions a file, folder, or partial path that appears under one of these locations, read it directly instead of asking them to attach it.",
    "Tool usage: do NOT call a tool literally named `read_file` or `read-file` — that name is from other agents and is not exposed here. Use the filesystem/shell tools that OpenClaw actually advertises in your tool list. If you are unsure which file tool to use, fall back to the shell tool (e.g. `shell`, `bash`, `exec`, `run_shell`, or whichever shell-execution tool is listed) and run `cat <path>`, `head -n 200 <path>`, or `ls -la <path>` against the absolute `/mnt/<drive>/...` path. Pass the path verbatim with no scheme prefix such as `open:` or `file:`.",
    "For local file, repository, or UI-flow questions, stay within local filesystem/project context. Do not call external search or web tools such as google:search unless the user explicitly asks for external or current web information.",
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

export function detectToolsEnabled(config: Record<string, unknown> | null): boolean | null {
  if (!config) {
    return null;
  }
  const tools = asRecord(config.tools);
  if (typeof tools.enabled === "boolean") {
    return tools.enabled;
  }
  if (Array.isArray(tools.allow) && tools.allow.length > 0) {
    return true;
  }
  const agent = asRecord(config.agent);
  const agentTools = asRecord(agent.tools);
  if (typeof agentTools.enabled === "boolean") {
    return agentTools.enabled;
  }
  const capabilities = config.capabilities;
  if (Array.isArray(capabilities)) {
    const names = capabilities.map((item) => String(item).toLowerCase());
    if (names.some((item) => item.includes("file") || item.includes("shell") || item.includes("read"))) {
      return true;
    }
  }
  return null;
}

export async function prefetchDirectoryListing(
  settings: AppSettings,
  wslPath: string,
  opts?: { maxDepth?: number; maxEntries?: number },
): Promise<string> {
  const maxDepth = opts?.maxDepth ?? 2;
  const maxEntries = opts?.maxEntries ?? 80;
  const escaped = wslPath.replaceAll("'", "'\"'\"'");
  const script = `find '${escaped}' -maxdepth ${maxDepth} \\( -type f -o -type d \\) 2>/dev/null | head -n ${maxEntries}`;
  try {
    const output = await runWsl(["-d", settings.wslDistro, "--", "sh", "-lc", script], { timeoutMs: 20000 });
    if (!output.trim()) {
      return `Directory listing for ${wslPath}: (empty or not accessible)`;
    }
    return `Directory listing for ${wslPath}:\n${output}`;
  } catch (error) {
    return `Directory listing for ${wslPath} failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function resolveReferencedWslPaths(message: string, windowsRoots: string[]): string[] {
  const lower = message.toLowerCase();
  const hits = new Set<string>();
  for (const root of windowsRoots) {
    const wsl = windowsPathToWsl(root);
    const segments = [
      ...root.split(/[/\\]/).filter(Boolean),
      ...wsl.split("/").filter(Boolean),
    ]
      .map((item) => item.toLowerCase())
      .filter((item) => item.length >= 3 && item !== "mnt" && !/^[a-z]$/.test(item));
    if (segments.some((segment) => lower.includes(segment))) {
      hits.add(wsl);
    }
  }
  return [...hits];
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
