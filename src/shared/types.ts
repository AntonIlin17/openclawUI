export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "running"
  | "streaming"
  | "idle"
  | "error";

export type ThinkingLevel = "none" | "brief" | "detailed";

export type AppSettings = {
  gatewayUrl: string;
  host: string;
  port: number;
  wslDistro: string;
  gatewayCommand: string;
  authMode: "auto" | "none" | "token" | "password";
  token?: string;
  password?: string;
  autostart: boolean;
  fileAccessPaths: string[];
  preferredModel?: string;
  thinking: ThinkingLevel;
};

export type AgentSummary = {
  id: string;
  name?: string;
};

export type ConversationSummary = {
  key: string;
  sessionId?: string;
  agentId: string;
  title: string;
  updatedAt?: number | null;
  preview?: string;
  model?: string;
  provider?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
};

export type Attachment = {
  id: string;
  name: string;
  type: string;
  windowsPath?: string;
  wslPath?: string;
  dataUrl?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  runId?: string;
  createdAt: number;
  attachments?: Attachment[];
  toolCallId?: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  toolPartial?: boolean;
  toolError?: boolean;
};

export type GatewayStatus = {
  state: ConnectionState;
  detail?: string;
  url?: string;
  model?: string;
  provider?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
};

export type ModelChoice = {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
};

export type GatewayEventFrame = {
  event: string;
  payload?: unknown;
  seq?: number;
};

export type SendMessageInput = {
  sessionKey: string;
  message: string;
  thinking: ThinkingLevel;
  deliver?: boolean;
  attachments?: Attachment[];
};

export type ExportInput = {
  sessionTitle: string;
  messages: ChatMessage[];
  format: "markdown" | "pdf";
};

export type IpcEvents = {
  "gateway:event": GatewayEventFrame;
  "gateway:status": GatewayStatus;
  "conversation:messages": { sessionKey: string; messages: ChatMessage[] };
  "tray:new-conversation": void;
  "tray:history": void;
  "app:settings": AppSettings;
};
