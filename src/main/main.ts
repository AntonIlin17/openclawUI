import { app, BrowserWindow, Menu, Tray, ipcMain, dialog, nativeImage } from "electron";
import path from "node:path";
import fs from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { GatewayClient } from "./gateway-client.js";
import { SettingsStore } from "./settings.js";
import { detectAuth, fileInfoFromPaths, orientOpenClaw, resolveWslIp, runWsl, windowsPathToWsl } from "./wsl.js";
import { exportConversation } from "./export.js";
import type {
  AgentSummary,
  AppSettings,
  ChatMessage,
  ConversationSummary,
  GatewayEventFrame,
  GatewayStatus,
  ModelChoice,
  SendMessageInput,
} from "../shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let gatewayProcess: ChildProcessWithoutNullStreams | null = null;
let settingsStore: SettingsStore;
let settings: AppSettings;
let gateway: GatewayClient;
const memoryMessages = new Map<string, ChatMessage[]>();

const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
}

app.on("second-instance", () => showWindow());

app.whenReady().then(async () => {
  settingsStore = new SettingsStore();
  settings = settingsStore.load();
  settings = settingsStore.save({ ...settings, ...(await detectAuth(settings)) });
  gateway = new GatewayClient({ userData: app.getPath("userData"), settings });
  wireGateway();
  createWindow();
  createTray();
  if (!(await probeGateway(settings.gatewayUrl))) {
    await startGatewayProcess();
  }
  gateway.start();
});

app.on("before-quit", () => {
  isQuitting = true;
  gateway?.stop();
  gatewayProcess?.kill();
});

function createWindow(): void {
  const preload = app.isPackaged
    ? path.join(app.getAppPath(), "preload.cjs")
    : path.join(process.cwd(), "preload.cjs");
  writeLog(`createWindow packaged=${app.isPackaged} dirname=${__dirname} preload=${preload}`);
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#141414",
    title: "OpenClaw Desktop",
    icon: assetPath("icon.png"),
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    writeLog(`did-fail-load code=${code} description=${description} url=${url}`);
    void mainWindow?.loadURL(errorDataUrl(`Renderer failed to load: ${description}`));
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    writeLog(`render-process-gone ${JSON.stringify(details)}`);
  });
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    writeLog(`renderer console level=${level} ${sourceId}:${line} ${message}`);
  });
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  if (isDev) {
    const url = process.env.VITE_DEV_SERVER_URL!;
    writeLog(`loadURL ${url}`);
    void mainWindow.loadURL(url);
  } else {
    const rendererPath = path.join(__dirname, "../renderer/index.html");
    writeLog(`loadFile ${rendererPath} exists=${fs.existsSync(rendererPath)}`);
    void mainWindow.loadFile(rendererPath);
  }
}

function createTray(): void {
  const trayIcon = assetPath("tray-idle.png");
  writeLog(`createTray icon=${trayIcon} exists=${fs.existsSync(trayIcon)}`);
  tray = new Tray(trayIcon);
  tray.setToolTip("OpenClaw Desktop");
  tray.on("click", () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      showWindow();
    }
  });
  updateTray(gateway.getStatus());
}

function updateTray(status: GatewayStatus): void {
  if (!tray) {
    return;
  }
  const icon = status.state === "streaming" || status.state === "running" ? "tray-streaming.png" : status.state === "idle" || status.state === "connected" ? "tray-idle.png" : "tray-disconnected.png";
  tray.setImage(nativeImage.createFromPath(assetPath(icon)));
  tray.setToolTip(`OpenClaw Desktop - ${status.detail ?? status.state}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open OpenClaw", click: showWindow },
      { label: "New conversation", click: () => sendToRenderer("tray:new-conversation", undefined) },
      { label: "Chat history", click: () => sendToRenderer("tray:history", undefined) },
      { type: "separator" },
      { label: `Gateway: ${status.detail ?? status.state}`, enabled: false },
      { label: "Start Gateway", click: () => void startGatewayProcess().then(() => gateway.start()) },
      { label: "Stop Gateway", click: () => void stopGatewayProcess() },
      { label: "Restart Gateway", click: () => void restartGateway() },
      { type: "separator" },
      { label: "Settings", click: () => sendToRenderer("app:settings", settings) },
      { label: "Exit", click: () => app.quit() },
    ]),
  );
}

function wireGateway(): void {
  gateway.on("status", (status: GatewayStatus) => {
    updateTray(status);
    sendToRenderer("gateway:status", status);
  });
  gateway.on("event", (event: GatewayEventFrame) => {
    ingestGatewayEvent(event);
    sendToRenderer("gateway:event", event);
  });
  gateway.on("connect-error", async () => {
    if (settings.host === "127.0.0.1") {
      const ip = await resolveWslIp(settings);
      if (ip) {
        settings = settingsStore.merge({ host: ip, gatewayUrl: `ws://${ip}:${settings.port}` });
        gateway.updateSettings(settings);
        gateway.start();
      }
    }
  });
}

function ingestGatewayEvent(event: GatewayEventFrame): void {
  if (event.event === "chat") {
    const payload = event.payload as { sessionKey?: string; runId?: string; state?: string; message?: unknown; deltaText?: string; errorMessage?: string } | undefined;
    if (!payload?.sessionKey) {
      return;
    }
    const messages = memoryMessages.get(payload.sessionKey) ?? [];
    if (payload.state === "delta") {
      const text = extractText(payload.message) || payload.deltaText || "";
      const existing = messages.find((item) => item.runId === payload.runId && item.role === "assistant");
      if (existing) {
        existing.content = text || existing.content;
      } else {
        messages.push({ id: `assistant-${payload.runId}`, role: "assistant", content: text, runId: payload.runId, createdAt: Date.now() });
      }
    }
    if (payload.state === "final") {
      const text = extractText(payload.message) || payload.errorMessage || "";
      const existing = messages.find((item) => item.runId === payload.runId && item.role === "assistant");
      if (existing) {
        existing.content = text || existing.content;
      } else {
        messages.push({ id: `assistant-${payload.runId}`, role: "assistant", content: text, runId: payload.runId, createdAt: Date.now() });
      }
    }
    memoryMessages.set(payload.sessionKey, messages);
    sendToRenderer("conversation:messages", { sessionKey: payload.sessionKey, messages });
  }
  if (event.event === "agent") {
    const payload = event.payload as { sessionKey?: string; runId?: string; stream?: string; data?: Record<string, unknown> } | undefined;
    if (payload?.stream !== "tool" || !payload.sessionKey) {
      return;
    }
    const data = payload.data ?? {};
    const messages = memoryMessages.get(payload.sessionKey) ?? [];
    const toolCallId = String(data.toolCallId ?? `${payload.runId}-${data.name ?? "tool"}`);
    let tool = messages.find((item) => item.toolCallId === toolCallId);
    if (!tool) {
      tool = {
        id: `tool-${toolCallId}`,
        role: "tool",
        content: "",
        runId: payload.runId,
        createdAt: Date.now(),
        toolCallId,
        toolName: String(data.name ?? "tool"),
        toolArgs: data.args,
      };
      messages.push(tool);
    }
    if (data.phase === "update") {
      tool.toolPartial = true;
      tool.toolResult = data.partialResult;
      tool.content = stringify(data.partialResult);
    }
    if (data.phase === "result") {
      tool.toolPartial = false;
      tool.toolError = Boolean(data.isError);
      tool.toolResult = data.result;
      tool.content = stringify(data.result);
    }
    memoryMessages.set(payload.sessionKey, messages);
    sendToRenderer("conversation:messages", { sessionKey: payload.sessionKey, messages });
  }
}

function registerIpc(): void {
  ipcMain.handle("settings:get", () => settings);
  ipcMain.handle("settings:save", (_event, next: AppSettings) => {
    settings = settingsStore.save(next);
    gateway.updateSettings(settings);
    app.setLoginItemSettings({ openAtLogin: settings.autostart });
    void orientOpenClaw(settings, settings.fileAccessPaths).catch((error) => {
      writeLog(`orientOpenClaw failed: ${String(error)}`);
    });
    sendToRenderer("app:settings", settings);
    return settings;
  });
  ipcMain.handle("gateway:status", () => gateway.getStatus());
  ipcMain.handle("gateway:connect", async () => {
    gateway.start();
    return gateway.getStatus();
  });
  ipcMain.handle("gateway:start", async () => {
    await startGatewayProcess();
    gateway.start();
    return gateway.getStatus();
  });
  ipcMain.handle("gateway:stop", async () => {
    await stopGatewayProcess();
    return gateway.getStatus();
  });
  ipcMain.handle("gateway:restart", async () => restartGateway());
  ipcMain.handle("agents:list", async (): Promise<AgentSummary[]> => {
    const result = await gateway.request<{ agents?: AgentSummary[] }>("agents.list", {});
    return result.agents ?? [{ id: "main", name: "Main" }];
  });
  ipcMain.handle("models:list", async (): Promise<ModelChoice[]> => {
    const result = await gateway.request<{ models?: ModelChoice[] }>("models.list", {});
    return result.models ?? [];
  });
  ipcMain.handle("sessions:list", async (_event, agentId?: string): Promise<ConversationSummary[]> => {
    const result = await gateway.request<{ sessions?: Array<Record<string, unknown>> }>("sessions.list", { agentId, limit: 200 });
    return (result.sessions ?? []).map(normalizeSession);
  });
  ipcMain.handle("sessions:create", async (_event, agentId: string): Promise<ConversationSummary> => {
    const localKey = `desktop-${Date.now().toString(36)}`;
    const result = await gateway.request<Record<string, unknown>>("sessions.create", { agentId, key: localKey, label: "New conversation" });
    return normalizeSession({ ...result, key: String(result.key ?? `agent:${agentId}:${localKey}`), agentId });
  });
  ipcMain.handle("sessions:rename", async (_event, key: string, title: string) => {
    await gateway.request("sessions.patch", { key, label: title, displayName: title });
  });
  ipcMain.handle("sessions:delete", async (_event, key: string) => {
    await gateway.request("sessions.reset", { key, reason: "reset" });
    memoryMessages.delete(key);
  });
  ipcMain.handle("history:load", async (_event, sessionKey: string, limit = 200) => {
    const result = await gateway.request("chat.history", { sessionKey, limit });
    memoryMessages.set(sessionKey, normalizeHistory(result));
    sendToRenderer("conversation:messages", { sessionKey, messages: memoryMessages.get(sessionKey) ?? [] });
    return result;
  });
  ipcMain.handle("chat:send", async (_event, input: SendMessageInput) => {
    const existing = memoryMessages.get(input.sessionKey) ?? [];
    existing.push({
      id: `user-${Date.now()}`,
      role: "user",
      content: input.message,
      attachments: input.attachments,
      createdAt: Date.now(),
    });
    memoryMessages.set(input.sessionKey, existing);
    sendToRenderer("conversation:messages", { sessionKey: input.sessionKey, messages: existing });
    return await gateway.sendChat(input);
  });
  ipcMain.handle("path:translate", (_event, windowsPath: string) => windowsPathToWsl(windowsPath));
  ipcMain.handle("paths:choose", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "multiSelections"] });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle("files:choose", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"] });
    return result.canceled ? [] : await fileInfoFromPaths(result.filePaths);
  });
  ipcMain.handle("openclaw:orient", async (_event, paths: string[]) => orientOpenClaw(settings, paths));
  ipcMain.handle("files:resolve", (_event, paths: string[]) => fileInfoFromPaths(paths));
  ipcMain.handle("conversation:export", (_event, input) => exportConversation(input));
}

registerIpc();

async function startGatewayProcess(): Promise<void> {
  if (await probeGateway(settings.gatewayUrl)) {
    return;
  }
  const command = settings.gatewayCommand || "openclaw gateway start";
  gatewayProcess = spawn("wsl.exe", ["-d", settings.wslDistro, "--", "sh", "-lc", command], {
    windowsHide: true,
  });
}

async function stopGatewayProcess(): Promise<void> {
  gateway.stop();
  try {
    await runWsl(["-d", settings.wslDistro, "--", "sh", "-lc", "openclaw gateway stop"], { timeoutMs: 15000 });
  } catch {}
  gatewayProcess?.kill();
  gatewayProcess = null;
}

async function restartGateway(): Promise<GatewayStatus> {
  gateway.stop();
  try {
    await runWsl(["-d", settings.wslDistro, "--", "sh", "-lc", "openclaw gateway restart"], { timeoutMs: 30000 });
  } catch {
    await startGatewayProcess();
  }
  gateway.start();
  return gateway.getStatus();
}

async function probeGateway(url: string): Promise<boolean> {
  const httpUrl = url.replace(/^ws:/, "http:").replace(/^wss:/, "https:").replace(/\/$/, "");
  try {
    const response = await fetch(`${httpUrl}/healthz`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

function showWindow(): void {
  if (!mainWindow) {
    return;
  }
  mainWindow.show();
  mainWindow.focus();
}

function sendToRenderer(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload);
}

function assetPath(name: string): string {
  return app.isPackaged ? path.join(app.getAppPath(), "assets", name) : path.join(process.cwd(), "assets", name);
}

function writeLog(message: string): void {
  try {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.appendFileSync(path.join(app.getPath("userData"), "openclaw-desktop.log"), line);
  } catch {}
}

function errorDataUrl(message: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><body style="margin:0;background:#141414;color:#f4efe7;font-family:Segoe UI;padding:32px"><h1>OpenClaw Desktop</h1><p>${message}</p><p>Log: ${path.join(app.getPath("userData"), "openclaw-desktop.log")}</p></body></html>`)}`;
}

function normalizeSession(raw: Record<string, unknown>): ConversationSummary {
  const key = String(raw.key ?? raw.sessionKey ?? "");
  const parsedAgent = key.match(/^agent:([^:]+):/)?.[1];
  return {
    key,
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : undefined,
    agentId: String(raw.agentId ?? parsedAgent ?? "main"),
    title: String(raw.label ?? raw.displayName ?? raw.derivedTitle ?? "New conversation"),
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : null,
    preview: typeof raw.lastMessagePreview === "string" ? raw.lastMessagePreview : undefined,
    model: typeof raw.model === "string" ? raw.model : undefined,
    provider: typeof raw.provider === "string" || typeof raw.modelProvider === "string" ? String(raw.provider ?? raw.modelProvider) : undefined,
    inputTokens: typeof raw.inputTokens === "number" ? raw.inputTokens : null,
    outputTokens: typeof raw.outputTokens === "number" ? raw.outputTokens : null,
    totalTokens: typeof raw.totalTokens === "number" ? raw.totalTokens : null,
  };
}

function normalizeHistory(raw: unknown): ChatMessage[] {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const messages = Array.isArray(record.messages) ? record.messages : Array.isArray(record.history) ? record.history : [];
  return messages.map((item, index) => {
    const message = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const role = message.role === "assistant" || message.role === "user" || message.role === "system" ? message.role : "assistant";
    return {
      id: String(message.id ?? `history-${index}`),
      role,
      content: extractText(message) || "",
      createdAt: typeof message.ts === "number" ? message.ts : Date.now() + index,
    } satisfies ChatMessage;
  });
}

function extractText(value: unknown): string {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  if (typeof record.content === "string") {
    return record.content;
  }
  if (typeof record.text === "string") {
    return record.text;
  }
  if (Array.isArray(record.content)) {
    return record.content
      .map((part) => {
        const block = part && typeof part === "object" ? (part as Record<string, unknown>) : {};
        return typeof block.text === "string" ? block.text : "";
      })
      .join("");
  }
  if (record.message) {
    return extractText(record.message);
  }
  return "";
}

function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
