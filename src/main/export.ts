import { BrowserWindow, dialog } from "electron";
import fs from "node:fs/promises";
import type { ChatMessage, ExportInput } from "../shared/types.js";

export async function exportConversation(input: ExportInput): Promise<string | null> {
  const markdown = toMarkdown(input.sessionTitle, input.messages);
  const result = await dialog.showSaveDialog({
    title: `Export ${input.sessionTitle}`,
    defaultPath: `${sanitize(input.sessionTitle)}.${input.format === "pdf" ? "pdf" : "md"}`,
    filters:
      input.format === "pdf"
        ? [{ name: "PDF", extensions: ["pdf"] }]
        : [{ name: "Markdown", extensions: ["md"] }],
  });
  if (result.canceled || !result.filePath) {
    return null;
  }
  if (input.format === "markdown") {
    await fs.writeFile(result.filePath, markdown, "utf8");
    return result.filePath;
  }
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Segoe UI,Arial,sans-serif;color:#151515;line-height:1.55;padding:36px}
    pre{background:#f3f3f3;padding:12px;border-radius:6px;overflow:auto}
    code{font-family:Consolas,monospace}
    h1{font-size:24px}
    .role{font-weight:700;margin-top:22px}
  </style></head><body>${markdownToBasicHtml(markdown)}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  const pdf = await win.webContents.printToPDF({ printBackground: true, margins: { marginType: "default" } });
  await fs.writeFile(result.filePath, pdf);
  win.destroy();
  return result.filePath;
}

function toMarkdown(title: string, messages: ChatMessage[]): string {
  const parts = [`# ${title}`, ""];
  for (const message of messages) {
    parts.push(`## ${label(message.role)}`, "");
    if (message.toolName) {
      parts.push(`**Tool:** ${message.toolName}`, "");
    }
    parts.push(message.content || formatUnknown(message.toolResult), "");
    if (message.attachments?.length) {
      parts.push("Attachments:", ...message.attachments.map((item) => `- ${item.name}: ${item.wslPath ?? item.windowsPath ?? ""}`), "");
    }
  }
  return parts.join("\n");
}

function label(role: ChatMessage["role"]): string {
  return role === "assistant" ? "Assistant" : role === "user" ? "User" : role === "tool" ? "Tool" : "System";
}

function formatUnknown(value: unknown): string {
  return value === undefined ? "" : `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function sanitize(value: string): string {
  return value.replace(/[<>:"/\\|?*]+/g, "-").slice(0, 80) || "openclaw-conversation";
}

function markdownToBasicHtml(markdown: string): string {
  return markdown
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/^## (.*)$/gm, '<div class="role">$1</div>')
    .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
    .replace(/\n/g, "<br>");
}
