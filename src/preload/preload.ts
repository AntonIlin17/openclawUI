import { contextBridge, ipcRenderer } from "electron";
import type { OpenClawDesktopApi } from "../shared/ipc.js";

const api: OpenClawDesktopApi = {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  getToolsStatus: () => ipcRenderer.invoke("openclaw:tools-status"),
  getStatus: () => ipcRenderer.invoke("gateway:status"),
  startGateway: () => ipcRenderer.invoke("gateway:start"),
  stopGateway: () => ipcRenderer.invoke("gateway:stop"),
  restartGateway: () => ipcRenderer.invoke("gateway:restart"),
  connectGateway: () => ipcRenderer.invoke("gateway:connect"),
  listAgents: () => ipcRenderer.invoke("agents:list"),
  listModels: () => ipcRenderer.invoke("models:list"),
  listConversations: (agentId) => ipcRenderer.invoke("sessions:list", agentId),
  createConversation: (agentId) => ipcRenderer.invoke("sessions:create", agentId),
  renameConversation: (key, title) => ipcRenderer.invoke("sessions:rename", key, title),
  deleteConversation: (key) => ipcRenderer.invoke("sessions:delete", key),
  loadHistory: (sessionKey, limit) => ipcRenderer.invoke("history:load", sessionKey, limit),
  sendMessage: (input) => ipcRenderer.invoke("chat:send", input),
  cancelRun: (input) => ipcRenderer.invoke("chat:cancel", input),
  translatePath: (windowsPath) => ipcRenderer.invoke("path:translate", windowsPath),
  chooseFileAccessPaths: () => ipcRenderer.invoke("paths:choose"),
  chooseAttachmentFiles: () => ipcRenderer.invoke("files:choose"),
  orientOpenClaw: (paths) => ipcRenderer.invoke("openclaw:orient", paths),
  exportConversation: (input) => ipcRenderer.invoke("conversation:export", input),
  resolveDroppedFiles: (paths) => ipcRenderer.invoke("files:resolve", paths),
  tailLogs: (limit) => ipcRenderer.invoke("logs:tail", limit),
  openLogsFolder: () => ipcRenderer.invoke("logs:open-folder"),
  openLogFile: () => ipcRenderer.invoke("logs:open-file"),
  getLogsPath: () => ipcRenderer.invoke("logs:get-path"),
  runDiagnostics: () => ipcRenderer.invoke("diagnostics:run"),
  checkForUpdates: () => ipcRenderer.invoke("updater:check"),
  on: (channel, handler) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => handler(payload as never);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
  },
};

contextBridge.exposeInMainWorld("openclaw", api);
