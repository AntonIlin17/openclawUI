import { app, BrowserWindow, Menu, Tray, ipcMain, dialog, nativeImage, safeStorage, shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
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
  runAllowedWslCommand,
  spawnAllowedWslProcess,
  windowsPathToWsl,
} from "./wsl.js";
import { exportConversation } from "./export.js";
import { assertTrustedIpcSender, isSafeExternalUrl, isTrustedRendererUrl } from "./ipc-security.js";
import { summarizeOpenClawConfig } from "./redaction.js";
import { createSecretProtector } from "./secure-storage.js";
import {
  parseAgentId,
  parseAppSettings,
  parseCancelRunInput,
  parseConversationTitle,
  parseExportInput,
  parseHistoryLimit,
  parseLogLimit,
  parseOptionalAgentId,
  parseSendMessageInput,
  parseSessionKey,
  parseWindowsPathArray,
  toRendererSettings,
} from "../shared/validation.js";
import type {
  ActiveRunStatus,
  AgentSummary,
  AppSettings,
  Attachment,
  CancelRunResult,
  ChatMessage,
  ConversationSummary,
  GatewayEventFrame,
  GatewayStatus,
  ModelChoice,
} from "../shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const rendererDirectory = path.join(__dirname, "../renderer");

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let gatewayProcess: ChildProcessWithoutNullStreams | null = null;
let modelProcess: ChildProcessWithoutNullStreams | null = null;
let gatewayWarmupInFlight: Promise<void> | null = null;
let settingsStore: SettingsStore;
let settings: AppSettings;
let gateway: GatewayClient;
const memoryMessages = new Map<string, ChatMessage[]>();
const activeRuns = new Map<string, ActiveRunStatus>();
const attachmentGrants = new Set<string>();

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
  const secretProtector = createSecretProtector(safeStorage);
  settingsStore = new SettingsStore(app.getPath("userData"), secretProtector);
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
  gateway = new GatewayClient({
    userData: app.getPath("userData"),
    settings,
    secretProtector,
    version: app.getVersion(),
  });
  wireGateway();
  registerIpc();
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
    backgroundColor: "#141414",
    title: "OpenClaw Desktop",
    icon: assetPath("icon.png"),
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const trusted = isTrustedRendererUrl(url, {
      rendererDirectory,
      devServerUrl: process.env.VITE_DEV_SERVER_URL,
    });
    if (!trusted) {
      event.preventDefault();
      if (isSafeExternalUrl(url)) {
        void shell.openExternal(url);
      }
    }
  });
  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
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
    if (settings.host === "127.0.0.1") {
      const ip = await resolveWslIp(settings);
      if (ip) {
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
  type TrustedHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
  const registerHandler = (channel: string, handler: TrustedHandler): void => {
    ipcMain.handle(channel, (event, ...args) => {
      assertTrustedIpcSender(event, {
        rendererDirectory,
        devServerUrl: process.env.VITE_DEV_SERVER_URL,
      });
      return handler(event, ...args);
    });
  };

  registerHandler("settings:get", () => toRendererSettings(settings));
  registerHandler("settings:save", async (_event, next: unknown) => {
    settings = settingsStore.save(parseAppSettings(next, settings));
    gateway.updateSettings(settings);
    app.setLoginItemSettings({ openAtLogin: settings.autostart });
    let orientError: string | undefined;
    try {
      await orientOpenClaw(settings, settings.fileAccessPaths);
    } catch (error) {
      orientError = error instanceof Error ? error.message : String(error);
      logger.warn("orient", "orientOpenClaw failed", { message: orientError });
    }
    const rendererSettings = toRendererSettings(settings);
    sendToRenderer("app:settings", rendererSettings);
    return { settings: rendererSettings, orientError };
  });
  registerHandler("openclaw:tools-status", async () => {
    const config = await readOpenClawConfig(settings);
    return { toolsEnabled: detectToolsEnabled(config) };
  });
  registerHandler("gateway:status", () => gateway.getStatus());
  registerHandler("gateway:connect", async () => {
    gateway.start();
    return gateway.getStatus();
  });
  registerHandler("gateway:start", async () => {
    await ensureServicesReady("manual");
    gateway.start();
    return gateway.getStatus();
  });
  registerHandler("gateway:stop", async () => {
    await stopGatewayProcess();
    return gateway.getStatus();
  });
  registerHandler("gateway:restart", async () => restartGateway());
  registerHandler("agents:list", async (): Promise<AgentSummary[]> => {
    const result = await gateway.request<{ agents?: AgentSummary[] }>("agents.list", {});
    return result.agents ?? [{ id: "main", name: "Main" }];
  });
  registerHandler("models:list", async (): Promise<ModelChoice[]> => {
    const result = await gateway.request<{ models?: ModelChoice[] }>("models.list", {});
    return result.models ?? [];
  });
  registerHandler("sessions:list", async (_event, rawAgentId?: unknown): Promise<ConversationSummary[]> => {
    const agentId = parseOptionalAgentId(rawAgentId);
    const result = await gateway.request<{ sessions?: Array<Record<string, unknown>> }>("sessions.list", { agentId, limit: 200 });
    return (result.sessions ?? []).map(normalizeSession);
  });
  registerHandler("sessions:create", async (_event, rawAgentId: unknown): Promise<ConversationSummary> => {
    const agentId = parseAgentId(rawAgentId);
    const localKey = `desktop-${Date.now().toString(36)}`;
    const result = await gateway.request<Record<string, unknown>>("sessions.create", { agentId, key: localKey, label: "New conversation" });
    return normalizeSession({ ...result, key: String(result.key ?? `agent:${agentId}:${localKey}`), agentId });
  });
  registerHandler("sessions:rename", async (_event, rawKey: unknown, rawTitle: unknown) => {
    const key = parseSessionKey(rawKey);
    const title = parseConversationTitle(rawTitle);
    await gateway.request("sessions.patch", { key, label: title, displayName: title });
  });
  registerHandler("sessions:delete", async (_event, rawKey: unknown) => {
    const key = parseSessionKey(rawKey);
    await gateway.request("sessions.reset", { key, reason: "reset" });
    memoryMessages.delete(key);
  });
  registerHandler("history:load", async (_event, rawSessionKey: unknown, rawLimit?: unknown) => {
    const sessionKey = parseSessionKey(rawSessionKey);
    const limit = parseHistoryLimit(rawLimit);
    const result = await gateway.request("chat.history", { sessionKey, limit });
    memoryMessages.set(sessionKey, normalizeHistory(result));
    sendToRenderer("conversation:messages", { sessionKey, messages: memoryMessages.get(sessionKey) ?? [] });
    return result;
  });
  registerHandler("chat:send", async (_event, rawInput: unknown) => {
    const input = parseSendMessageInput(rawInput);
    input.attachments = await normalizeAuthorizedAttachments(input.attachments ?? []);
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
  registerHandler("chat:cancel", async (_event, rawInput: unknown): Promise<CancelRunResult> => {
    const input = parseCancelRunInput(rawInput);
    const activeRun = activeRuns.get(input.sessionKey);
    if (!activeRun || activeRun.runId !== input.runId) {
      return { ok: true, message: "No active run" };
    }
    activeRuns.set(input.sessionKey, { ...activeRun, activity: "Cancelling run", cancelRequested: true });
    return await gateway.cancelRun(input);
  });
  registerHandler("path:translate", (_event, rawWindowsPath: unknown) => {
    const [windowsPath] = parseWindowsPathArray([rawWindowsPath], "windowsPath", 1);
    return windowsPathToWsl(windowsPath);
  });
  registerHandler("paths:choose", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "multiSelections"] });
    return result.canceled ? [] : result.filePaths;
  });
  registerHandler("files:choose", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"] });
    if (result.canceled) {
      return [];
    }
    const files = await fileInfoFromPaths(result.filePaths);
    grantAttachments(files);
    return files;
  });
  registerHandler("openclaw:orient", async (_event, rawPaths: unknown) => {
    const paths = parseWindowsPathArray(rawPaths, "file access paths", 20);
    return orientOpenClaw(settings, paths);
  });
  registerHandler("files:resolve", async (_event, rawPaths: unknown) => {
    const paths = parseWindowsPathArray(rawPaths, "dropped file paths", 50);
    const files = await fileInfoFromPaths(paths, settings.fileAccessPaths);
    grantAttachments(files);
    return files;
  });
  registerHandler("conversation:export", (_event, rawInput: unknown) => exportConversation(parseExportInput(rawInput)));
  registerHandler("logs:tail", (_event, rawLimit?: unknown) => logger.tail(parseLogLimit(rawLimit)));
  registerHandler("logs:open-folder", () => {
    logger.openLogDir();
  });
  registerHandler("logs:open-file", () => shell.openPath(logger.getLogFile()));
  registerHandler("logs:get-path", () => ({ file: logger.getLogFile(), folder: logger.getLogDir() }));
  registerHandler("diagnostics:run", async () => {
    await runGatewayDiagnostics();
    return logger.tail(200);
  });
  registerHandler("updater:check", async () => {
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

function grantAttachments(files: Attachment[]): void {
  for (const file of files) {
    if (file.windowsPath) {
      attachmentGrants.add(attachmentGrantKey(file.windowsPath));
    }
  }
}

async function normalizeAuthorizedAttachments(attachments: Attachment[]): Promise<Attachment[]> {
  const normalized: Attachment[] = [];
  for (const attachment of attachments) {
    if (attachment.dataUrl) {
      normalized.push({
        id: attachment.id,
        name: attachment.name,
        type: attachment.type,
        dataUrl: attachment.dataUrl,
      });
      continue;
    }
    if (!attachment.windowsPath || !attachmentGrants.has(attachmentGrantKey(attachment.windowsPath))) {
      throw new Error("Attachment was not selected through the system file picker or an allowed folder");
    }
    const [resolved] = await fileInfoFromPaths([attachment.windowsPath]);
    normalized.push(resolved);
  }
  return normalized;
}

function attachmentGrantKey(filePath: string): string {
  return path.win32.resolve(filePath).toLowerCase();
}

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
      ["-d", settings.wslDistro, "--", "bash", "-ilc", "command -v openclaw >/dev/null 2>&1 && printf present || printf missing"],
      { timeoutMs: 10_000, logScope: "openclaw-probe" },
    );
    if (output.trim() !== "present") {
      logger.warn("openclaw-probe", "openclaw not found on PATH inside WSL");
    } else {
      logger.info("openclaw-probe", "openclaw resolved on PATH");
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
  if (settings.modelStartCommand !== "ollama serve") {
    logger.debug("model", "no modelStartCommand configured — skipping");
    return;
  }
  if (modelProcess && !modelProcess.killed) {
    logger.debug("model", "model process already running");
    return;
  }
  logger.info("model", "starting reviewed local model command");
  modelProcess = spawnAllowedWslProcess(settings, "model-ollama");
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
  logger.info("gateway-proc", "spawning reviewed gateway command", { distro: settings.wslDistro });
  gatewayProcess = spawnAllowedWslProcess(settings, "gateway-start");
  logger.attachChild("gateway-proc", gatewayProcess);
  gatewayProcess.on("exit", (code, signal) => {
    logger.info("gateway-proc", `gateway process exited`, { code, signal });
    gatewayProcess = null;
  });
}

async function runGatewayDiagnostics(): Promise<void> {
  const config = await readOpenClawConfig(settings);
  logger.info("diag", "OpenClaw configuration summary", summarizeOpenClawConfig(config));
  const commands = [
    { label: "openclaw doctor", command: "doctor" as const, timeoutMs: 30_000 },
    { label: "openclaw gateway status", command: "gateway-status" as const, timeoutMs: 15_000 },
  ];
  for (const item of commands) {
    try {
      await runAllowedWslCommand(settings, item.command, { timeoutMs: item.timeoutMs, logScope: "diag" });
      logger.info("diag", item.label, { ok: true });
    } catch (error) {
      logger.warn("diag", item.label, { ok: false, reason: errorMessage(error) });
    }
  }
  logger.info("diag", "gateway health", { ok: await probeGateway(settings.gatewayUrl) });
  let encryptedStorageAvailable = false;
  try {
    encryptedStorageAvailable = safeStorage.isEncryptionAvailable();
  } catch {}
  logger.info("diag", "encrypted credential storage", { available: encryptedStorageAvailable });
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
    await runAllowedWslCommand(settings, "gateway-stop", { timeoutMs: 15000, logScope: "gateway-proc" });
  } catch {}
  gatewayProcess?.kill();
  gatewayProcess = null;
}

async function restartGateway(): Promise<GatewayStatus> {
  gateway.stop();
  try {
    await runAllowedWslCommand(settings, "gateway-restart", { timeoutMs: 30000, logScope: "gateway-proc" });
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
        ...(isDev
          ? [
              { role: "reload" as const },
              { role: "forceReload" as const },
              { role: "toggleDevTools" as const },
              { type: "separator" as const },
            ]
          : []),
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
  const safeMessage = escapeHtml(message);
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><body style="margin:0;background:#141414;color:#f4efe7;font-family:Segoe UI;padding:32px"><h1>OpenClaw Desktop</h1><p>${safeMessage}</p><p>Open Settings → Diagnostics for recovery details.</p></body></html>`)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
      const [prefix] = existing.content.split(marker);
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
