import type { AppSettings } from "./types.js";

const FILE_ACCESS_OPEN = "<openclaw_desktop_file_access>";
const FILE_ACCESS_CLOSE = "</openclaw_desktop_file_access>";
const ATTACHMENTS_OPEN = "<openclaw_desktop_attachments>";
const ATTACHMENTS_CLOSE = "</openclaw_desktop_attachments>";

export function windowsPathToWslInline(windowsPath: string): string {
  const normalized = windowsPath.replaceAll("/", "\\");
  const match = normalized.match(/^([A-Za-z]):\\?(.*)$/);
  if (!match) {
    return windowsPath.replaceAll("\\", "/");
  }
  const rest = match[2] ? `/${match[2].replaceAll("\\", "/")}` : "";
  return `/mnt/${match[1].toLowerCase()}${rest}`;
}

export function buildFileAccessContext(settings: AppSettings, attachments?: unknown[]): string {
  const roots = settings.fileAccessPaths ?? [];
  const lines: string[] = [];
  if (roots.length > 0) {
    lines.push(
      FILE_ACCESS_OPEN,
      "The user has granted OpenClaw Desktop access to these Windows roots. You may read files under them directly; do not ask the user to attach files that are already under these roots.",
      "Resolve Windows paths through WSL drive mounts. If the user mentions a folder/file by name or a partial path, search/list within these roots first.",
      "Tool usage: do NOT call a tool literally named `read_file` or `read-file` — that name comes from other agents (e.g. Cursor/Claude Code) and is not exposed by this OpenClaw runtime; calling it will return `Tool read_file not found`. Use the actual filesystem/shell tools advertised in your tool list. If no dedicated file-read tool is listed, fall back to the shell tool (whichever name it has — `shell`, `bash`, `exec`, `run_shell`, etc.) and run `cat <path>` / `head -n 200 <path>` / `ls -la <path>` on the absolute `/mnt/<drive>/...` path. Pass the path verbatim — never prefix it with `open:`, `file:`, or any other scheme.",
      "For questions about local files, folders, repositories, or code flow, use only local filesystem/project context unless the user explicitly asks for external or current web information. Do not call web search tools such as google:search for local-code requests.",
    );
    for (const root of roots) {
      lines.push(`- Windows: ${root}`);
      lines.push(`  WSL: ${windowsPathToWslInline(root)}`);
    }
    lines.push(FILE_ACCESS_CLOSE);
  }
  if (attachments?.length) {
    lines.push(
      ATTACHMENTS_OPEN,
      ...attachments.map((item) => {
        const record = item as { name?: string; wslPath?: string; windowsPath?: string };
        return `- ${record.name ?? "file"}: ${record.wslPath ?? record.windowsPath ?? ""}`;
      }),
      ATTACHMENTS_CLOSE,
    );
  }
  return lines.join("\n");
}

function extractBlock(content: string, open: string, close: string): { stripped: string; block: string } {
  const start = content.indexOf(open);
  if (start === -1) {
    return { stripped: content, block: "" };
  }
  const end = content.indexOf(close, start);
  if (end === -1) {
    return { stripped: content, block: "" };
  }
  const block = content.slice(start, end + close.length).trim();
  const stripped = `${content.slice(0, start)}${content.slice(end + close.length)}`.replace(/\n{3,}/g, "\n\n").trim();
  return { stripped, block };
}

export function splitDesktopContext(content: string): { userText: string; thinkingText: string } {
  let userText = content;
  const thinkingParts: string[] = [];
  const fileAccess = extractBlock(userText, FILE_ACCESS_OPEN, FILE_ACCESS_CLOSE);
  userText = fileAccess.stripped;
  if (fileAccess.block) {
    thinkingParts.push(fileAccess.block);
  }
  const attachments = extractBlock(userText, ATTACHMENTS_OPEN, ATTACHMENTS_CLOSE);
  userText = attachments.stripped;
  if (attachments.block) {
    thinkingParts.push(attachments.block);
  }
  return { userText: userText.trim(), thinkingText: thinkingParts.join("\n\n").trim() };
}

export function buildWireMessage(userMessage: string, context: string): string {
  return [userMessage, context].filter(Boolean).join("\n\n");
}
