import type {
  AppSettings,
  Attachment,
  CancelRunInput,
  ExportInput,
  SendMessageInput,
  ThinkingLevel,
} from "./types.js";

const AUTH_MODES = new Set<AppSettings["authMode"]>(["auto", "none", "token", "password"]);
const THINKING_LEVELS = new Set<ThinkingLevel>(["none", "brief", "detailed"]);
const ALLOWED_GATEWAY_COMMAND = "openclaw gateway start";
const ALLOWED_MODEL_COMMANDS = new Set(["", "ollama serve"]);
const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:\\/;

export const IPC_EVENT_CHANNELS = [
  "gateway:event",
  "gateway:status",
  "conversation:messages",
  "tray:new-conversation",
  "tray:history",
  "app:settings",
  "logs:entry",
] as const;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function isIpcEventChannel(value: string): boolean {
  return (IPC_EVENT_CHANNELS as readonly string[]).includes(value);
}

export function parseAppSettings(value: unknown, previous?: AppSettings): AppSettings {
  const record = asRecord(value, "settings");
  const gatewayUrl = parseGatewayUrl(stringField(record, "gatewayUrl", 2048));
  const authMode = enumField(record, "authMode", AUTH_MODES);
  const token = parseSecretUpdate(record, "token", "clearToken", previous?.token);
  const password = parseSecretUpdate(record, "password", "clearPassword", previous?.password);
  const modelStartCommand = optionalString(record.modelStartCommand, "modelStartCommand", 128) ?? "";
  if (!ALLOWED_MODEL_COMMANDS.has(modelStartCommand)) {
    throw new ValidationError("modelStartCommand must be empty or the reviewed 'ollama serve' command");
  }
  const gatewayCommand = stringField(record, "gatewayCommand", 128).trim();
  if (gatewayCommand !== ALLOWED_GATEWAY_COMMAND) {
    throw new ValidationError(`gatewayCommand must be '${ALLOWED_GATEWAY_COMMAND}'`);
  }
  const fileAccessPaths = parseWindowsPathArray(record.fileAccessPaths, "fileAccessPaths", 20);
  const port = numberField(record, "port", 1, 65535);
  const urlPort = gatewayUrl.port ? Number(gatewayUrl.port) : gatewayUrl.protocol === "wss:" ? 443 : 80;
  if (gatewayUrl.port && urlPort !== port) {
    throw new ValidationError("gatewayUrl port must match port");
  }
  const host = stringField(record, "host", 255).trim().toLowerCase();
  if (normalizeHost(gatewayUrl.hostname) !== normalizeHost(host)) {
    throw new ValidationError("gatewayUrl host must match host");
  }
  return {
    gatewayUrl: gatewayUrl.toString().replace(/\/$/, ""),
    host,
    port,
    wslDistro: parseDistro(stringField(record, "wslDistro", 64)),
    gatewayCommand,
    modelStartCommand: modelStartCommand as AppSettings["modelStartCommand"],
    autoStartGateway: booleanField(record, "autoStartGateway"),
    authMode,
    token,
    password,
    autostart: booleanField(record, "autostart"),
    fileAccessPaths,
    prefetchFileListings: booleanField(record, "prefetchFileListings"),
    preferredModel: optionalString(record.preferredModel, "preferredModel", 256),
    thinking: enumField(record, "thinking", THINKING_LEVELS),
  };
}

export function toRendererSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    token: undefined,
    password: undefined,
    hasToken: Boolean(settings.token),
    hasPassword: Boolean(settings.password),
    clearToken: undefined,
    clearPassword: undefined,
  };
}

export function parseAgentId(value: unknown): string {
  return boundedString(value, "agentId", 1, 256);
}

export function parseOptionalAgentId(value: unknown): string | undefined {
  return value === undefined ? undefined : parseAgentId(value);
}

export function parseSessionKey(value: unknown): string {
  return boundedString(value, "sessionKey", 1, 1024);
}

export function parseConversationTitle(value: unknown): string {
  return boundedString(value, "title", 1, 200).trim();
}

export function parseHistoryLimit(value: unknown): number {
  if (value === undefined) {
    return 200;
  }
  return boundedInteger(value, "history limit", 1, 500);
}

export function parseLogLimit(value: unknown): number {
  if (value === undefined) {
    return 400;
  }
  return boundedInteger(value, "log limit", 1, 1000);
}

export function parseSendMessageInput(value: unknown): SendMessageInput {
  const record = asRecord(value, "sendMessage input");
  const message = typeof record.message === "string" ? record.message : "";
  if (message.length > 100_000) {
    throw new ValidationError("message exceeds 100000 characters");
  }
  const attachments = parseAttachments(record.attachments);
  if (!message.trim() && attachments.length === 0) {
    throw new ValidationError("message or attachment is required");
  }
  return {
    sessionKey: parseSessionKey(record.sessionKey),
    message,
    thinking: enumValue(record.thinking, "thinking", THINKING_LEVELS),
    deliver: record.deliver === undefined ? undefined : booleanValue(record.deliver, "deliver"),
    attachments,
  };
}

export function parseCancelRunInput(value: unknown): CancelRunInput {
  const record = asRecord(value, "cancelRun input");
  return {
    sessionKey: parseSessionKey(record.sessionKey),
    runId: boundedString(record.runId, "runId", 1, 256),
  };
}

export function parseWindowsPathArray(value: unknown, label = "paths", maximum = 50): string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new ValidationError(`${label} must be an array with at most ${maximum} items`);
  }
  const unique = new Set<string>();
  for (const item of value) {
    const candidate = boundedString(item, label, 3, 1024).replaceAll("/", "\\");
    if (!WINDOWS_ABSOLUTE_PATH.test(candidate) || candidate.includes("\0")) {
      throw new ValidationError(`${label} must contain absolute Windows drive paths`);
    }
    unique.add(candidate);
  }
  return [...unique];
}

export function parseExportInput(value: unknown): ExportInput {
  const record = asRecord(value, "export input");
  if (record.format !== "markdown" && record.format !== "pdf") {
    throw new ValidationError("export format must be markdown or pdf");
  }
  if (!Array.isArray(record.messages) || record.messages.length > 10_000) {
    throw new ValidationError("export messages must be an array with at most 10000 items");
  }
  return {
    sessionTitle: boundedString(record.sessionTitle, "sessionTitle", 1, 200),
    messages: record.messages as ExportInput["messages"],
    format: record.format,
  };
}

function parseAttachments(value: unknown): Attachment[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > 20) {
    throw new ValidationError("attachments must be an array with at most 20 items");
  }
  return value.map((item, index) => {
    const record = asRecord(item, `attachment ${index + 1}`);
    const windowsPath = optionalString(record.windowsPath, "windowsPath", 1024);
    const wslPath = optionalString(record.wslPath, "wslPath", 1024);
    const dataUrl = optionalString(record.dataUrl, "dataUrl", 10 * 1024 * 1024);
    if (!windowsPath && !dataUrl) {
      throw new ValidationError(`attachment ${index + 1} requires a path or data URL`);
    }
    if (dataUrl && !/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) {
      throw new ValidationError("attachment dataUrl must be a base64 image");
    }
    return {
      id: boundedString(record.id, "attachment id", 1, 1024),
      name: boundedString(record.name, "attachment name", 1, 255),
      type: boundedString(record.type, "attachment type", 1, 128),
      windowsPath,
      wslPath,
      dataUrl,
    };
  });
}

function parseSecretUpdate(
  record: Record<string, unknown>,
  key: "token" | "password",
  clearKey: "clearToken" | "clearPassword",
  previous: string | undefined,
): string | undefined {
  if (record[clearKey] === true) {
    return undefined;
  }
  const value = optionalString(record[key], key, 4096);
  return value?.trim() ? value : previous;
}

function parseGatewayUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ValidationError("gatewayUrl must be a valid URL");
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new ValidationError("gatewayUrl must use ws or wss");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ValidationError("gatewayUrl must not contain credentials, query parameters, or a fragment");
  }
  if (!isLocalOrPrivateHost(url.hostname)) {
    throw new ValidationError("gatewayUrl must target localhost or a private network address");
  }
  return url;
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (host === "localhost" || host === "::1" || host.startsWith("127.")) {
    return true;
  }
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
}

function normalizeHost(value: string): string {
  return value.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
}

function parseDistro(value: string): string {
  const distro = value.trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(distro)) {
    throw new ValidationError("wslDistro contains unsupported characters");
  }
  return distro;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string, maximum: number): string {
  return boundedString(record[key], key, 1, maximum);
}

function optionalString(value: unknown, label: string, maximum: number): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return boundedString(value, label, 0, maximum);
}

function boundedString(value: unknown, label: string, minimum: number, maximum: number): string {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum || value.includes("\0")) {
    throw new ValidationError(`${label} must be a string between ${minimum} and ${maximum} characters`);
  }
  return value;
}

function numberField(record: Record<string, unknown>, key: string, minimum: number, maximum: number): number {
  return boundedInteger(record[key], key, minimum, maximum);
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new ValidationError(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
}

function booleanField(record: Record<string, unknown>, key: string): boolean {
  return booleanValue(record[key], key);
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new ValidationError(`${label} must be a boolean`);
  }
  return value;
}

function enumField<T extends string>(record: Record<string, unknown>, key: string, allowed: Set<T>): T {
  return enumValue(record[key], key, allowed);
}

function enumValue<T extends string>(value: unknown, label: string, allowed: Set<T>): T {
  if (typeof value !== "string" || !allowed.has(value as T)) {
    throw new ValidationError(`${label} has an unsupported value`);
  }
  return value as T;
}
