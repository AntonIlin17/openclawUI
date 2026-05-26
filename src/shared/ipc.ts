import type {
  AgentSummary,
  AppSettings,
  Attachment,
  CancelRunInput,
  CancelRunResult,
  ConversationSummary,
  ExportInput,
  GatewayStatus,
  ModelChoice,
  SendMessageInput,
} from "./types.js";

export type SaveSettingsResult = {
  settings: AppSettings;
  orientError?: string;
};

export type ToolsStatus = {
  toolsEnabled: boolean | null;
};

export type LogEntry = {
  ts: string;
  level: "debug" | "info" | "warn" | "error";
  scope: string;
  message: string;
  data?: unknown;
};

export type UpdateCheckResult = {
  ok: boolean;
  version?: string;
  current?: string;
  reason?: string;
};

export type OpenClawDesktopApi = {
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<SaveSettingsResult>;
  getToolsStatus(): Promise<ToolsStatus>;
  getStatus(): Promise<GatewayStatus>;
  startGateway(): Promise<GatewayStatus>;
  stopGateway(): Promise<GatewayStatus>;
  restartGateway(): Promise<GatewayStatus>;
  connectGateway(): Promise<GatewayStatus>;
  listAgents(): Promise<AgentSummary[]>;
  listModels(): Promise<ModelChoice[]>;
  listConversations(agentId?: string): Promise<ConversationSummary[]>;
  createConversation(agentId: string): Promise<ConversationSummary>;
  renameConversation(key: string, title: string): Promise<void>;
  deleteConversation(key: string): Promise<void>;
  loadHistory(sessionKey: string, limit?: number): Promise<unknown>;
  sendMessage(input: SendMessageInput): Promise<{ runId: string }>;
  cancelRun(input: CancelRunInput): Promise<CancelRunResult>;
  translatePath(windowsPath: string): Promise<string>;
  chooseFileAccessPaths(): Promise<string[]>;
  chooseAttachmentFiles(): Promise<Attachment[]>;
  orientOpenClaw(paths: string[]): Promise<void>;
  exportConversation(input: ExportInput): Promise<string | null>;
  resolveDroppedFiles(paths: string[]): Promise<Attachment[]>;
  tailLogs(limit?: number): Promise<LogEntry[]>;
  openLogsFolder(): Promise<void>;
  openLogFile(): Promise<string>;
  getLogsPath(): Promise<{ file: string; folder: string }>;
  runDiagnostics(): Promise<LogEntry[]>;
  checkForUpdates(): Promise<UpdateCheckResult>;
  on<T>(channel: string, handler: (payload: T) => void): () => void;
};
