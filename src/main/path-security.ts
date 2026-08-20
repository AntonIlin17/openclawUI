import fs from "node:fs/promises";
import path from "node:path";

export function windowsPathToWslSafe(windowsPath: string): string {
  if (windowsPath.includes("\0")) {
    throw new Error("Path contains a null byte");
  }
  const raw = windowsPath.replaceAll("/", "\\");
  if (!/^[A-Za-z]:\\/.test(raw)) {
    throw new Error("Only absolute Windows drive paths are supported");
  }
  const normalized = path.win32.resolve(raw);
  const match = normalized.match(/^([A-Za-z]):\\(.*)$/);
  if (!match) {
    throw new Error("Only absolute Windows drive paths are supported");
  }
  const rest = match[2].split("\\").join("/");
  return `/mnt/${match[1].toLowerCase()}/${rest}`.replace(/\/$/, "");
}

export function isPathContained(candidate: string, roots: string[]): boolean {
  const normalizedCandidate = normalizeForComparison(candidate);
  return roots.some((root) => {
    const normalizedRoot = normalizeForComparison(root);
    const relative = path.win32.relative(normalizedRoot, normalizedCandidate);
    return relative === "" || (!relative.startsWith("..\\") && relative !== ".." && !path.win32.isAbsolute(relative));
  });
}

export async function resolveContainedPath(candidate: string, roots: string[]): Promise<string> {
  if (!isPathContained(candidate, roots)) {
    throw new Error("Path is outside the folders granted in Settings");
  }
  const [realCandidate, ...realRoots] = await Promise.all([
    fs.realpath(candidate),
    ...roots.map(async (root) => {
      try {
        return await fs.realpath(root);
      } catch {
        return path.win32.resolve(root);
      }
    }),
  ]);
  if (!isPathContained(realCandidate, realRoots)) {
    throw new Error("Path resolves outside the folders granted in Settings");
  }
  return realCandidate;
}

export async function resolveContainedPaths(candidates: string[], roots: string[]): Promise<string[]> {
  if (roots.length === 0 && candidates.length > 0) {
    throw new Error("Add a folder in Settings before dropping files from it");
  }
  return await Promise.all(candidates.map((candidate) => resolveContainedPath(candidate, roots)));
}

export function resolveReferencedWslPaths(message: string, windowsRoots: string[]): string[] {
  const lower = message.toLowerCase();
  const hits = new Set<string>();
  for (const root of windowsRoots) {
    const wsl = windowsPathToWslSafe(root);
    const segments = [...root.split(/[/\\]/).filter(Boolean), ...wsl.split("/").filter(Boolean)]
      .map((item) => item.toLowerCase())
      .filter((item) => item.length >= 3 && item !== "mnt" && !/^[a-z]$/.test(item));
    if (segments.some((segment) => lower.includes(segment))) {
      hits.add(wsl);
    }
  }
  return [...hits];
}

function normalizeForComparison(value: string): string {
  return path.win32.resolve(value.replaceAll("/", "\\")).replace(/[\\/]+$/, "").toLowerCase();
}
