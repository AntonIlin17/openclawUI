import type {
  AgentSummary,
  AppSettings,
  Attachment,
  ConversationSummary,
  ExportInput,
  GatewayStatus,
  ModelChoice,
  SendMessageInput,
} from "./types.js";

export type OpenClawDesktopApi = {
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
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
  translatePath(windowsPath: string): Promise<string>;
  chooseFileAccessPaths(): Promise<string[]>;
  chooseAttachmentFiles(): Promise<Attachment[]>;
  orientOpenClaw(paths: string[]): Promise<void>;
  exportConversation(input: ExportInput): Promise<string | null>;
  resolveDroppedFiles(paths: string[]): Promise<Attachment[]>;
  on<T>(channel: string, handler: (payload: T) => void): () => void;
};
