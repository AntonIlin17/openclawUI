import { app, BrowserWindow, Menu, Tray, ipcMain, dialog, nativeImage, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import electronUpdaterPkg from "electron-updater";
const { autoUpdater } = electronUpdaterPkg;
import { GatewayClient } from "./gateway-client.js";
import { SettingsStore } from "./settings.js";
import { logger } from "./logger.js";
import { buildFileAccessContext, splitDesktopContext } from "../shared/message-context.js";
import {
  detectAuth,
  detectToolsEnabled,
  fileInfoFromPaths,
  orientOpenClaw,
  prefetchDirectoryListing,
  readOpenClawConfig,
  resolveReferencedWslPaths,
  resolveWslIp,
  runWsl,
  windowsPathToWsl,
} from "./wsl.js";
import { exportConversation } from "./export.js";
import type {
  ActiveRunStatus,
  AgentSummary,
  AppSettings,
  CancelRunInput,
  CancelRunResult,
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
let modelProcess: ChildProcessWithoutNullStreams | null = null;
let wslKeepAlive: ChildProcessWithoutNullStreams | null = null;
let gatewayWarmupInFlight: Promise<void> | null = null;
let settingsStore: SettingsStore;
let settings: AppSettings;
let gateway: GatewayClient;
const memoryMessages = new Map<string, ChatMessage[]>();
const activeRuns = new Map<string, ActiveRunStatus>();

const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
}

app.on("second-instance", () => showWindow());

app.whenReady().then(async () => {
  logger.init();
  logger.info("boot", "app ready", {
    version: app.getVersion(),
    packaged: app.isPackaged,
    userData: app.getPath("userData"),
  });
  settingsStore = new SettingsStore();
  settings = settingsStore.load();
  logger.info("boot", "settings loaded", {
    gatewayUrl: settings.gatewayUrl,
    wslDistro: settings.wslDistro,
    autoStartGateway: settings.autoStartGateway,
    gatewayCommand: settings.gatewayCommand,
    modelStartCommand: settings.modelStartCommand,
    authMode: settings.authMode,
  });
  try {
    const detected = await detectAuth(settings);
    settings = settingsStore.save({ ...settings, ...detected });
    logger.info("boot", "auth detection complete", { detectedKeys: Object.keys(detected) });
  } catch (error) {
    logger.warn("boot", "auth detection failed", { message: errorMessage(error) });
  }
  gateway = new GatewayClient({ userData: app.getPath("userData"), settings });
  wireGateway();
  createWindow();
  createTray();
  initAutoUpdater();
  if (settings.autoStartGateway) {
    await ensureServicesReady("app-open");
  } else {
    logger.info("boot", "autoStartGateway disabled — skipping warmup");
  }
  gateway.start();
});

app.on("before-quit", () => {
  isQuitting = true;
  gateway?.stop();
  gatewayProcess?.kill();
  modelProcess?.kill();
  wslKeepAlive?.kill();
});

function createWindow(): void {
  const preload = app.isPackaged
    ? path.join(app.getAppPath(), "preload.cjs")
    : path.join(process.cwd(), "preload.cjs");
  logger.info("window", "createWindow", { packaged: app.isPackaged, dirname: __dirname, preload });
  Menu.setApplicationMenu(buildAppMenu());
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#f9faf7",
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
    logger.error("renderer", `did-fail-load`, { code, description, url });
    void mainWindow?.loadURL(errorDataUrl(`Renderer failed to load: ${description}`));
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    logger.error("renderer", `render-process-gone`, details);
  });
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    logger.debug("renderer-console", message, { level, sourceId, line });
  });
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  if (isDev) {
    const url = process.env.VITE_DEV_SERVER_URL!;
    logger.info("window", `loadURL ${url}`);
    void mainWindow.loadURL(url);
  } else {
    const rendererPath = path.join(__dirname, "../renderer/index.html");
    logger.info("window", `loadFile ${rendererPath}`, { exists: fs.existsSync(rendererPath) });
    void mainWindow.loadFile(rendererPath);
  }
}

function createTray(): void {
  const trayIcon = assetPath("tray-idle.png");
  logger.info("tray", `createTray`, { trayIcon, exists: fs.existsSync(trayIcon) });
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
      { label: "Start Gateway", click: () => void ensureServicesReady("tray").then(() => gateway.start()) },
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
  let connectErrorCount = 0;
  gateway.on("connect-error", async (detail) => {
    connectErrorCount += 1;
    logger.warn("gateway-conn", "connect-error", { detail, count: connectErrorCount, url: settings.gatewayUrl });
    // Authentication/protocol failures need to be shown, not treated as an
    // unreachable host. Changing addresses cannot repair a rejected handshake.
    if (!/ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENOTFOUND/i.test(String(detail))) return;
    if (settings.host === "127.0.0.1") {
      const ip = await resolveWslIp(settings);
      if (ip && await probeGateway(`ws://${ip}:${settings.port}`)) {
        logger.info("gateway-conn", `localhost unreachable — switching to WSL IP ${ip}`);
        settings = settingsStore.merge({ host: ip, gatewayUrl: `ws://${ip}:${settings.port}` });
        gateway.updateSettings(settings);
        gateway.start();
        return;
      }
    }
    if (settings.autoStartGateway) {
      await ensureServicesReady("connect-error");
      gateway.start();
    }
    if (connectErrorCount === 3) {
      logger.warn("gateway-conn", "persistent connect failure — running diagnostics");
      await runGatewayDiagnostics().catch(() => undefined);
    }
  });
  gateway.on("status", (status) => {
    if (status.state === "idle" || status.state === "connected") {
      if (connectErrorCount > 0) {
        logger.info("gateway-conn", "connection recovered");
      }
      connectErrorCount = 0;
    }
  });
}

function ingestGatewayEvent(event: GatewayEventFrame): void {
  if (event.event === "chat") {
    const payload = event.payload as { sessionKey?: string; runId?: string; state?: string; message?: unknown; deltaText?: string; errorMessage?: string } | undefined;
    if (!payload?.sessionKey) {
      return;
    }
    if (payload.runId && (payload.state === "final" || payload.state === "aborted" || payload.state === "error")) {
      const activeRun = activeRuns.get(payload.sessionKey);
      if (!activeRun || activeRun.runId === payload.runId) {
        activeRuns.delete(payload.sessionKey);
      }
    }
    const messages = memoryMessages.get(payload.sessionKey) ?? [];
    if (payload.state === "delta" || payload.state === "final") {
      const modelThinking = extractModelThinking(payload.message);
      if (modelThinking && payload.runId) {
        upsertModelThinking(messages, payload.runId, modelThinking);
      }
    }
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
    if (payload.runId) {
      const existingRun = activeRuns.get(payload.sessionKey);
      const toolName = String(data.name ?? "tool");
      const isResult = data.phase === "result";
      if (!existingRun || existingRun.runId === payload.runId) {
        activeRuns.set(payload.sessionKey, {
          sessionKey: payload.sessionKey,
          runId: payload.runId,
          startedAt: existingRun?.startedAt ?? Date.now(),
          cancelRequested: existingRun?.cancelRequested,
          activity: isResult ? `${data.isError ? "Tool failed" : "Tool complete"}: ${toolName}` : `Tool: ${toolName}`,
          toolName,
        });
      }
    }
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
  ipcMain.handle("setup:status", async () => {
    const [config, ollamaReachable] = await Promise.all([
      readOpenClawConfig(settings),
      fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(3000) }).then(response => response.ok).catch(() => false),
    ]);
    const agents = config?.agents as { defaults?: { model?: string | { primary?: string } } } | undefined;
    const model = agents?.defaults?.model;
    return { ollamaReachable, configuredModel: typeof model === "string" ? model : model?.primary };
  });
  ipcMain.handle("settings:get", () => settings);
  ipcMain.handle("settings:save", async (_event, next: AppSettings) => {
    const address = new URL(next.gatewayUrl);
    if (!["ws:", "wss:"].includes(address.protocol)) throw new Error("Connection address must use ws:// or wss://");
    next = { ...next, host: address.hostname, port: Number(address.port || (address.protocol === "wss:" ? 443 : 80)) };
    gateway.stop();
    settings = settingsStore.save(next);
    gateway.updateSettings(settings);
    app.setLoginItemSettings({ openAtLogin: settings.autostart });
    let orientError: string | undefined;
    try {
      await orientOpenClaw(settings, settings.fileAccessPaths);
    } catch (error) {
      orientError = error instanceof Error ? error.message : String(error);
      logger.warn("orient", "orientOpenClaw failed", { message: orientError });
    }
    sendToRenderer("app:settings", settings);
    gateway.start();
    return { settings, orientError };
  });
  ipcMain.handle("openclaw:tools-status", async () => {
    const config = await readOpenClawConfig(settings);
    return { toolsEnabled: detectToolsEnabled(config) };
  });
  ipcMain.handle("gateway:status", () => gateway.getStatus());
  ipcMain.handle("gateway:connect", async () => {
    gateway.start();
    return gateway.getStatus();
  });
  ipcMain.handle("gateway:start", async () => {
    await ensureServicesReady("manual");
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
    const runId = randomUUID();
    const createdAt = Date.now();
    activeRuns.set(input.sessionKey, {
      sessionKey: input.sessionKey,
      runId,
      startedAt: createdAt,
      activity: "Sending request",
    });
    existing.push({
      id: `user-${createdAt}`,
      role: "user",
      content: input.message,
      attachments: input.attachments,
      runId,
      createdAt,
    });
    let thinkingContent = buildFileAccessContext(settings, input.attachments);
    if (settings.prefetchFileListings !== false && settings.fileAccessPaths.length > 0) {
      const referenced = resolveReferencedWslPaths(input.message, settings.fileAccessPaths);
      for (const wslPath of referenced) {
        const listing = await prefetchDirectoryListing(settings, wslPath);
        thinkingContent = [thinkingContent, listing].filter(Boolean).join("\n\n");
      }
    }
    if (thinkingContent.trim()) {
      existing.push({
        id: `thinking-${runId}`,
        role: "thinking",
        content: thinkingContent,
        thinkingLabel: "File access context",
        runId,
        createdAt: createdAt + 1,
      });
    }
    memoryMessages.set(input.sessionKey, existing);
    sendToRenderer("conversation:messages", { sessionKey: input.sessionKey, messages: existing });
    try {
      return await gateway.sendChat({ ...input, runId });
    } catch (error) {
      activeRuns.delete(input.sessionKey);
      throw error;
    }
  });
  ipcMain.handle("chat:cancel", async (_event, input: CancelRunInput): Promise<CancelRunResult> => {
    const activeRun = activeRuns.get(input.sessionKey);
    if (!activeRun || activeRun.runId !== input.runId) {
      return { ok: true, message: "No active run" };
    }
    activeRuns.set(input.sessionKey, { ...activeRun, activity: "Cancelling run", cancelRequested: true });
    return await gateway.cancelRun(input);
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
  ipcMain.handle("logs:tail", (_event, limit?: number) => logger.tail(limit ?? 400));
  ipcMain.handle("logs:open-folder", () => {
    logger.openLogDir();
  });
  ipcMain.handle("logs:open-file", () => shell.openPath(logger.getLogFile()));
  ipcMain.handle("logs:get-path", () => ({ file: logger.getLogFile(), folder: logger.getLogDir() }));
  ipcMain.handle("diagnostics:run", async () => {
    await runGatewayDiagnostics();
    return logger.tail(200);
  });
  ipcMain.handle("updater:check", async () => {
    if (!app.isPackaged) {
      return { ok: false, reason: "dev-mode", version: app.getVersion() };
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      return { ok: true, version: result?.updateInfo?.version ?? app.getVersion(), current: app.getVersion() };
    } catch (error) {
      return { ok: false, reason: errorMessage(error), current: app.getVersion() };
    }
  });

  logger.on("entry", (entry) => {
    sendToRenderer("logs:entry", entry);
  });
}

registerIpc();

async function ensureServicesReady(reason: string): Promise<void> {
  if (gatewayWarmupInFlight) {
    logger.debug("warmup", `ensureServicesReady(${reason}) — joining in-flight warmup`);
    return gatewayWarmupInFlight;
  }
  gatewayWarmupInFlight = (async () => {
    logger.info("warmup", `ensureServicesReady started`, { reason });
    try {
      await ensureWslSubsystemReady();
      await ensureWslDistroReady();
      await probeOpenClawPath();
      await startModelProcess();
      if (await probeGateway(settings.gatewayUrl)) {
        logger.info("warmup", "gateway already healthy on entry");
        return;
      }
      await startGatewayProcess();
      const ready = await waitForGateway(settings.gatewayUrl, 90_000);
      if (!ready) {
        logger.warn("warmup", "gateway health check timed out — running diagnostics");
        await runGatewayDiagnostics();
      } else {
        logger.info("warmup", "gateway healthy");
      }
    } catch (error) {
      logger.error("warmup", "ensureServicesReady failed", { message: errorMessage(error) });
      await runGatewayDiagnostics().catch(() => undefined);
    } finally {
      gatewayWarmupInFlight = null;
    }
  })();
  return gatewayWarmupInFlight;
}

async function ensureWslSubsystemReady(): Promise<void> {
  try {
    await runWsl(["--status"], { timeoutMs: 10_000, logScope: "wsl-status" });
    logger.info("warmup", "wsl subsystem responded to --status");
  } catch (error) {
    logger.warn("warmup", "wsl --status failed — WSL may not be installed", { message: errorMessage(error) });
  }
}

async function probeOpenClawPath(): Promise<void> {
  try {
    const output = await runWsl(
      ["-d", settings.wslDistro, "--", "bash", "-ilc", "command -v openclaw || which openclaw || true; echo '---'; echo \"PATH=$PATH\""],
      { timeoutMs: 10_000, logScope: "openclaw-probe" },
    );
    const [pathLine, ...rest] = output.split("---");
    const resolved = pathLine.trim();
    if (!resolved) {
      logger.warn("openclaw-probe", "openclaw NOT found on PATH inside WSL", { wslPath: rest.join("---").trim() });
    } else {
      logger.info("openclaw-probe", "openclaw resolved", { binary: resolved, wslPath: rest.join("---").trim() });
    }
  } catch (error) {
    logger.warn("openclaw-probe", "probe failed", { message: errorMessage(error) });
  }
}

async function ensureWslDistroReady(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    try {
      await runWsl(["-d", settings.wslDistro, "--", "echo", "ok"], { timeoutMs: 15_000, logScope: "wsl-warmup" });
      if (!wslKeepAlive || wslKeepAlive.killed) {
        wslKeepAlive = spawn("wsl.exe", ["-d", settings.wslDistro, "--", "sleep", "infinity"], { windowsHide: true });
        logger.attachChild("wsl-lifetime", wslKeepAlive);
        wslKeepAlive.once("exit", () => { wslKeepAlive = null; });
        wslKeepAlive.once("error", () => { wslKeepAlive = null; });
      }
      logger.info("warmup", `wsl distro "${settings.wslDistro}" ready`, { attempts: attempt });
      return;
    } catch (error) {
      logger.warn("warmup", `wsl distro warmup attempt ${attempt} failed`, { message: errorMessage(error) });
      await sleep(2_000);
    }
  }
  throw new Error(`WSL distro "${settings.wslDistro}" did not respond in time`);
}

async function startModelProcess(): Promise<void> {
  const command = settings.modelStartCommand?.trim();
  if (!command) {
    logger.debug("model", "no modelStartCommand configured — skipping");
    return;
  }
  if (modelProcess && !modelProcess.killed) {
    logger.debug("model", "model process already running");
    return;
  }
  logger.info("model", `starting model: ${command}`);
  modelProcess = spawn("wsl.exe", ["-d", settings.wslDistro, "--", "bash", "-ilc", command], {
    windowsHide: true,
  });
  logger.attachChild("model", modelProcess);
  modelProcess.on("exit", (code, signal) => {
    logger.info("model", `model process exited`, { code, signal });
    modelProcess = null;
  });
  await sleep(2_000);
}

async function startGatewayProcess(): Promise<void> {
  if (await probeGateway(settings.gatewayUrl)) {
    logger.debug("gateway-proc", "skip start — already healthy");
    return;
  }
  if (gatewayProcess && !gatewayProcess.killed) {
    logger.debug("gateway-proc", "gateway process already running");
    return;
  }
  const command = settings.gatewayCommand || "openclaw gateway start";
  logger.info("gateway-proc", `spawning gateway`, { command, distro: settings.wslDistro });
  gatewayProcess = spawn("wsl.exe", ["-d", settings.wslDistro, "--", "bash", "-ilc", command], {
    windowsHide: true,
  });
  logger.attachChild("gateway-proc", gatewayProcess);
  gatewayProcess.on("exit", (code, signal) => {
    logger.info("gateway-proc", `gateway process exited`, { code, signal });
    gatewayProcess = null;
  });
}

async function runGatewayDiagnostics(): Promise<void> {
  const commands: Array<{ label: string; cmd: string; timeoutMs: number }> = [
    { label: "openclaw doctor", cmd: "openclaw doctor 2>&1 || true", timeoutMs: 30_000 },
    { label: "openclaw gateway status", cmd: "openclaw gateway status 2>&1 || true", timeoutMs: 15_000 },
    { label: "gateway healthz", cmd: `curl -sS -m 3 ${settings.gatewayUrl.replace(/^ws/, "http").replace(/\/$/, "")}/healthz || true`, timeoutMs: 10_000 },
    { label: "openclaw config", cmd: "cat ~/.openclaw/openclaw.json 2>&1 | head -n 80 || true", timeoutMs: 10_000 },
  ];
  for (const item of commands) {
    try {
      const output = await runWsl(["-d", settings.wslDistro, "--", "bash", "-ilc", item.cmd], { timeoutMs: item.timeoutMs, logScope: "diag" });
      logger.info("diag", item.label, { output: output.slice(0, 4000) });
    } catch (error) {
      logger.warn("diag", `${item.label} failed`, { message: errorMessage(error) });
    }
  }
}

async function waitForGateway(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let delayMs = 1_000;
  while (Date.now() < deadline) {
    if (await probeGateway(url)) {
      return true;
    }
    await sleep(delayMs);
    delayMs = Math.min(Math.round(delayMs * 1.5), 5_000);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopGatewayProcess(): Promise<void> {
  gateway.stop();
  try {
    await runWsl(["-d", settings.wslDistro, "--", "bash", "-ilc", "openclaw gateway stop"], { timeoutMs: 15000, logScope: "gateway-proc" });
  } catch {}
  gatewayProcess?.kill();
  gatewayProcess = null;
}

async function restartGateway(): Promise<GatewayStatus> {
  gateway.stop();
  try {
    await runWsl(["-d", settings.wslDistro, "--", "bash", "-ilc", "openclaw gateway restart"], { timeoutMs: 30000, logScope: "gateway-proc" });
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
  if (mainWindow.isMinimized()) mainWindow.restore();
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
  logger.info("legacy", message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildAppMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: "File",
      submenu: [
        { label: "New conversation", accelerator: "CmdOrCtrl+N", click: () => sendToRenderer("tray:new-conversation", undefined) },
        { type: "separator" },
        { label: "Exit", click: () => app.quit() },
      ],
    },
    { label: "Edit", role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { label: "Window", role: "windowMenu" },
    {
      label: "Help",
      submenu: [
        { label: "Open logs folder", click: () => logger.openLogDir() },
        { label: "Open log file", click: () => void shell.openPath(logger.getLogFile()) },
        { type: "separator" },
        { label: "Check for updates", click: () => void manualCheckForUpdates() },
        { label: `Version ${app.getVersion()}`, enabled: false },
      ],
    },
  ]);
}

function initAutoUpdater(): void {
  if (!app.isPackaged) {
    logger.info("updater", "skipping auto-updater in dev mode");
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (msg: unknown) => logger.info("updater", String(msg)),
    warn: (msg: unknown) => logger.warn("updater", String(msg)),
    error: (msg: unknown) => logger.error("updater", String(msg)),
    debug: (msg: unknown) => logger.debug("updater", String(msg)),
  } as never;
  autoUpdater.on("checking-for-update", () => logger.info("updater", "checking-for-update"));
  autoUpdater.on("update-available", (info: unknown) => logger.info("updater", "update-available", info));
  autoUpdater.on("update-not-available", (info: unknown) => logger.info("updater", "update-not-available", info));
  autoUpdater.on("download-progress", (progress: unknown) => logger.debug("updater", "download-progress", progress));
  autoUpdater.on("update-downloaded", (info: unknown) => {
    logger.info("updater", "update-downloaded — will install on quit", info);
    void dialog
      .showMessageBox({
        type: "info",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        message: "An OpenClaw Desktop update has been downloaded.",
        detail: "Restart to apply the update now, or it will be installed automatically the next time you quit.",
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });
  autoUpdater.on("error", (error: Error) => logger.error("updater", "auto-updater error", { message: error.message }));
  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((error: unknown) => logger.warn("updater", "initial check failed", { message: errorMessage(error) }));
  }, 8_000);
}

async function manualCheckForUpdates(): Promise<void> {
  if (!app.isPackaged) {
    await dialog.showMessageBox({ type: "info", message: "Update check is only available in installed builds." });
    return;
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    const version = result?.updateInfo?.version;
    if (!version || version === app.getVersion()) {
      await dialog.showMessageBox({ type: "info", message: "You're up to date.", detail: `Current version: ${app.getVersion()}` });
    } else {
      await dialog.showMessageBox({ type: "info", message: `Update ${version} found.`, detail: "Downloading in the background." });
    }
  } catch (error) {
    await dialog.showMessageBox({ type: "error", message: "Update check failed", detail: errorMessage(error) });
  }
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
  const expanded: ChatMessage[] = [];
  let index = 0;
  for (const item of messages) {
    const message = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const rawRole = message.role === "assistant" || message.role === "user" || message.role === "system" ? message.role : "assistant";
    const text = extractText(message) || "";
    const createdAt = typeof message.ts === "number" ? message.ts : Date.now() + index;
    const runId = typeof message.runId === "string" ? message.runId : undefined;
    if (rawRole === "user") {
      const { userText, thinkingText } = splitDesktopContext(text);
      expanded.push({
        id: String(message.id ?? `history-${index}`),
        role: "user",
        content: userText,
        runId,
        createdAt,
      });
      index += 1;
      if (thinkingText) {
        expanded.push({
          id: `${String(message.id ?? `history-${index}`)}-thinking`,
          role: "thinking",
          content: thinkingText,
          thinkingLabel: "File access context",
          runId,
          createdAt: createdAt + 1,
        });
        index += 1;
      }
      continue;
    }
    expanded.push({
      id: String(message.id ?? `history-${index}`),
      role: rawRole,
      content: text,
      runId,
      createdAt,
    });
    index += 1;
  }
  return expanded;
}

function upsertModelThinking(messages: ChatMessage[], runId: string, modelThinking: string): void {
  const trimmed = modelThinking.trim();
  if (!trimmed) {
    return;
  }
  const existing = messages.find((item) => item.runId === runId && item.role === "thinking");
  if (existing) {
    const marker = "## Model reasoning\n";
    if (existing.content.includes(marker)) {
      const [prefix, rest] = existing.content.split(marker);
      const combined = `${prefix}${marker}${trimmed}`;
      existing.content = combined.trim();
      return;
    }
    existing.content = `${existing.content}\n\n${marker}${trimmed}`.trim();
    if (!existing.thinkingLabel || existing.thinkingLabel === "File access context") {
      existing.thinkingLabel = "Thinking";
    }
    return;
  }
  messages.push({
    id: `thinking-model-${runId}`,
    role: "thinking",
    content: trimmed,
    thinkingLabel: "Thinking",
    runId,
    createdAt: Date.now(),
  });
}

function extractModelThinking(value: unknown): string {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  if (typeof record.thinking === "string") {
    return record.thinking;
  }
  if (typeof record.reasoning === "string") {
    return record.reasoning;
  }
  if (Array.isArray(record.content)) {
    return record.content
      .map((part) => {
        const block = part && typeof part === "object" ? (part as Record<string, unknown>) : {};
        const type = String(block.type ?? "").toLowerCase();
        if (type === "thinking" || type === "reasoning") {
          return typeof block.text === "string" ? block.text : "";
        }
        return "";
      })
      .join("");
  }
  return "";
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
