import { EventEmitter } from "node:events";
import { randomUUID, createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";
import { buildFileAccessContext, buildWireMessage } from "../shared/message-context.js";
import type { ActiveRunStatus, AppSettings, CancelRunInput, CancelRunResult, GatewayEventFrame, GatewayStatus, ThinkingLevel } from "../shared/types.js";

const PROTOCOL_VERSION = 4;
const DEFAULT_URL = "ws://127.0.0.1:18789";

type GatewayFrame =
  | { type: "event"; event: string; payload?: unknown; seq?: number }
  | { type: "res"; id: string; ok: boolean; payload?: unknown; error?: GatewayError };

type GatewayError = {
  code?: string;
  message?: string;
  details?: unknown;
  retryable?: boolean;
  retryAfterMs?: number;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  expectFinal: boolean;
  timeout?: NodeJS.Timeout;
};

type DeviceIdentity = {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
};

export type GatewayClientOptions = {
  userData: string;
  settings: AppSettings;
};

export class GatewayRequestError extends Error {
  readonly gatewayCode: string;
  readonly details?: unknown;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(error: GatewayError) {
    super(error.message ?? "OpenClaw Gateway request failed");
    this.name = "GatewayRequestError";
    this.gatewayCode = error.code ?? "UNKNOWN";
    this.details = error.details;
    this.retryable = error.retryable === true;
    this.retryAfterMs = error.retryAfterMs;
  }
}

export class GatewayClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private challengeTimer: NodeJS.Timeout | null = null;
  private backoffMs = 1000;
  private stopped = true;
  private nonce: string | null = null;
  private connectSent = false;
  private tickTimer: NodeJS.Timeout | null = null;
  private lastTick = 0;
  private tickIntervalMs = 30000;
  private device: DeviceIdentity;
  private deviceToken?: string;
  private storedScopes?: string[];
  private status: GatewayStatus = { state: "disconnected", url: DEFAULT_URL };

  constructor(private options: GatewayClientOptions) {
    super();
    this.device = this.loadOrCreateDeviceIdentity();
    this.loadDeviceToken();
  }

  updateSettings(settings: AppSettings): void {
    this.options.settings = settings;
    this.status = { ...this.status, url: settings.gatewayUrl };
  }

  getStatus(): GatewayStatus {
    return this.status;
  }

  start(): void {
    this.stopped = false;
    this.setStatus({ state: "connecting", detail: "Connecting to Gateway" });
    this.openSocket();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.flushPending(new Error("gateway client stopped"));
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus({ state: "disconnected", detail: "Disconnected" });
  }

  async request<T = unknown>(method: string, params?: unknown, opts?: { expectFinal?: boolean; timeoutMs?: number | null }): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.connectSent) {
      throw new Error("gateway not connected");
    }
    const id = randomUUID();
    const frame = { type: "req", id, method, params };
    const timeoutMs = opts?.timeoutMs === null ? null : opts?.timeoutMs ?? (opts?.expectFinal ? null : 30000);
    const promise = new Promise<T>((resolve, reject) => {
      const timeout = timeoutMs
        ? setTimeout(() => {
            this.pending.delete(id);
            reject(new Error(`gateway request timeout for ${method}`));
          }, timeoutMs)
        : undefined;
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        expectFinal: opts?.expectFinal === true,
        timeout,
      });
    });
    this.ws.send(JSON.stringify(frame));
    return promise;
  }

  async sendChat(input: {
    sessionKey: string;
    message: string;
    thinking: ThinkingLevel;
    deliver?: boolean;
    attachments?: unknown[];
    runId?: string;
  }): Promise<{ runId: string }> {
    const runId = input.runId ?? randomUUID();
    const activeRun: ActiveRunStatus = {
      sessionKey: input.sessionKey,
      runId,
      startedAt: Date.now(),
      activity: "Sending request",
    };
    this.setStatus({ state: "running", detail: "OpenClaw running", activeRun });
    const context = buildFileAccessContext(this.options.settings, input.attachments);
    const message = buildWireMessage(input.message, context);
    try {
      await this.request("chat.send", {
        sessionKey: input.sessionKey,
        message,
        thinking: input.thinking,
        deliver: input.deliver ?? false,
        idempotencyKey: runId,
      });
    } catch (error) {
      this.setStatus({ state: "error", detail: error instanceof Error ? error.message : String(error), activeRun: undefined });
      throw error;
    }
    this.setStatus({ state: "running", detail: "Run accepted", activeRun: { ...activeRun, activity: "Run accepted" } });
    return { runId };
  }

  async cancelRun(input: CancelRunInput): Promise<CancelRunResult> {
    const current = this.status.activeRun;
    const activeRun: ActiveRunStatus =
      current?.runId === input.runId && current.sessionKey === input.sessionKey
        ? current
        : { sessionKey: input.sessionKey, runId: input.runId, startedAt: Date.now() };

    this.setStatus({
      state: this.status.state === "streaming" ? "streaming" : "running",
      detail: "Cancelling run",
      activeRun: { ...activeRun, activity: "Cancelling run", cancelRequested: true },
    });

    const params = { sessionKey: input.sessionKey, runId: input.runId, idempotencyKey: input.runId };
    const methods = ["chat.abort", "chat.cancel"];
    for (const method of methods) {
      try {
        await this.request(method, params, { timeoutMs: 10000 });
        this.setStatus({
          state: this.status.state === "streaming" ? "streaming" : "running",
          detail: "Cancel requested",
          activeRun: { ...activeRun, activity: "Cancel requested", cancelRequested: true },
        });
        return { ok: true, message: "Cancel requested" };
      } catch (error) {
        if (this.isUnsupportedRpc(error)) {
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        this.setStatus({ state: "error", detail: `Cancel failed: ${message}`, activeRun });
        return { ok: false, message };
      }
    }

    const message = "Cancel not supported by Gateway";
    this.setStatus({
      state: this.status.state === "streaming" ? "streaming" : "running",
      detail: message,
      activeRun: { ...activeRun, activity: message, cancelRequested: false },
    });
    return { ok: false, unsupported: true, message };
  }

  private openSocket(): void {
    this.clearTimers();
    const previous = this.ws;
    this.ws = null;
    if (previous) {
      this.flushPending(new Error("gateway connection replaced"));
      previous.terminate();
    }
    this.nonce = null;
    this.connectSent = false;
    const url = this.options.settings.gatewayUrl || DEFAULT_URL;
    this.status.url = url;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url, { maxPayload: 25 * 1024 * 1024 });
    } catch (error) {
      this.handleConnectError(error);
      return;
    }
    this.ws = ws;
    ws.on("open", () => { if (this.ws === ws) this.armChallengeTimeout(); });
    ws.on("message", (raw) => { if (this.ws === ws) this.handleMessage(raw.toString()); });
    ws.on("error", (error) => { if (this.ws === ws) this.handleConnectError(error); });
    ws.on("close", (code, reason) => {
      if (this.ws !== ws) return;
      this.flushPending(new Error(`gateway closed (${code}): ${reason.toString()}`));
      this.ws = null;
      this.connectSent = false;
      this.clearTimers();
      if (!this.stopped) {
        if (this.status.state !== "error") this.setStatus({ state: "disconnected", detail: reason.toString() || `Gateway closed (${code})` });
        this.scheduleReconnect();
      }
    });
  }

  private handleMessage(raw: string): void {
    let frame: GatewayFrame;
    try {
      frame = JSON.parse(raw) as GatewayFrame;
    } catch {
      return;
    }
    this.lastTick = Date.now();
    if (frame.type === "event") {
      if (frame.event === "connect.challenge") {
        const payload = frame.payload as { nonce?: unknown } | undefined;
        this.nonce = typeof payload?.nonce === "string" ? payload.nonce : null;
        this.sendConnect();
        return;
      }
      if (frame.event === "tick") {
        return;
      }
      this.emit("event", frame satisfies GatewayEventFrame);
      this.updateStatusFromEvent(frame);
      return;
    }
    if (frame.type === "res") {
      const pending = this.pending.get(frame.id);
      if (!pending) {
        return;
      }
      const payload = frame.payload as { status?: unknown } | undefined;
      if (pending.expectFinal && payload?.status === "accepted") {
        return;
      }
      this.pending.delete(frame.id);
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      if (frame.ok) {
        pending.resolve(frame.payload);
      } else {
        pending.reject(new GatewayRequestError(frame.error ?? { message: "unknown error" }));
      }
    }
  }

  private sendConnect(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.connectSent) {
      return;
    }
    if (!this.nonce) {
      this.ws.close(1008, "connect challenge missing nonce");
      return;
    }
    this.connectSent = true;
    this.clearChallengeTimer();
    const signedAt = Date.now();
    const scopes = this.storedScopes?.length ? this.storedScopes : ["operator.admin"];
    const auth = this.resolveAuth();
    const signatureToken = auth?.token ?? auth?.bootstrapToken ?? auth?.deviceToken ?? auth?.password ?? "";
    const payload = [
      "v3",
      this.device.deviceId,
      "openclaw-tui",
      "ui",
      "operator",
      scopes.join(","),
      String(signedAt),
      signatureToken,
      this.nonce,
      process.platform,
      "",
    ].join("|");
    const connect = {
      type: "req",
      id: randomUUID(),
      method: "connect",
      params: {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: "openclaw-tui",
          displayName: "OpenClaw Desktop",
          version: "0.1.0",
          platform: process.platform,
          mode: "ui",
          instanceId: randomUUID(),
        },
        role: "operator",
        scopes,
        caps: ["tool-events"],
        auth,
        device: {
          id: this.device.deviceId,
          publicKey: this.publicKeyRawBase64Url(),
          signature: sign(null, Buffer.from(payload), this.device.privateKeyPem).toString("base64url"),
          signedAt,
          nonce: this.nonce,
        },
      },
    };
    const id = connect.id;
    this.pending.set(id, {
      expectFinal: false,
      resolve: (hello) => {
        const record = hello as { policy?: { tickIntervalMs?: number }; auth?: { deviceToken?: string; scopes?: string[] } };
        if (record.auth?.deviceToken) {
          this.deviceToken = record.auth.deviceToken;
          this.storedScopes = record.auth.scopes;
          this.saveDeviceToken();
        }
        this.tickIntervalMs = record.policy?.tickIntervalMs ?? 30000;
        this.startTickWatch();
        this.backoffMs = 1000;
        this.setStatus({ state: "idle", detail: "Connected" });
      },
      reject: (error) => {
        this.handleConnectError(error);
        this.ws?.close(1008, "connect failed");
      },
    });
    this.ws.send(JSON.stringify(connect));
  }

  private resolveAuth(): Record<string, string> | undefined {
    const settings = this.options.settings;
    if (settings.authMode === "token" && settings.token) {
      return { token: settings.token };
    }
    if (settings.authMode === "password" && settings.password) {
      return { password: settings.password };
    }
    if (settings.authMode === "auto") {
      if (settings.token) {
        return { token: settings.token };
      }
      if (settings.password) {
        return { password: settings.password };
      }
      if (this.deviceToken) {
        return { token: this.deviceToken, deviceToken: this.deviceToken };
      }
    }
    return this.deviceToken ? { token: this.deviceToken, deviceToken: this.deviceToken } : undefined;
  }

  private updateStatusFromEvent(frame: GatewayEventFrame): void {
    if (frame.event === "chat") {
      const payload = frame.payload as { sessionKey?: string; runId?: string; state?: string; message?: { model?: string; provider?: string } } | undefined;
      if (payload?.state === "delta") {
        this.setStatus({ state: "streaming", detail: "Streaming reply", activeRun: this.activeRunFor(payload, "Streaming reply") });
      }
      if (payload?.state === "final" || payload?.state === "aborted" || payload?.state === "error") {
        this.setStatus({
          state: payload.state === "error" ? "error" : "idle",
          detail: payload.state === "error" ? "Run failed" : payload.state === "aborted" ? "Run cancelled" : "Idle",
          activeRun: this.shouldClearActiveRun(payload) ? undefined : this.status.activeRun,
          model: payload.message?.model,
          provider: payload.message?.provider,
        });
      }
    }
    if (frame.event === "agent") {
      const payload = frame.payload as { sessionKey?: string; runId?: string; stream?: string; data?: { phase?: string; name?: unknown; isError?: unknown } } | undefined;
      if (payload?.stream === "lifecycle" && payload.data?.phase === "start") {
        this.setStatus({ state: "running", detail: "Agent running", activeRun: this.activeRunFor(payload, "Agent running") });
      }
      if (payload?.stream === "tool") {
        const toolName = typeof payload.data?.name === "string" ? payload.data.name : "tool";
        const isResult = payload.data?.phase === "result";
        const activity = isResult ? `${payload.data?.isError ? "Tool failed" : "Tool complete"}: ${toolName}` : `Tool: ${toolName}`;
        this.setStatus({
          state: isResult ? "running" : "streaming",
          detail: activity,
          activeRun: this.activeRunFor(payload, activity, { toolName }),
        });
      }
    }
  }

  private activeRunFor(payload: { sessionKey?: string; runId?: string } | undefined, activity: string, extra?: Partial<ActiveRunStatus>): ActiveRunStatus | undefined {
    const current = this.status.activeRun;
    const sessionKey = payload?.sessionKey ?? current?.sessionKey;
    const runId = payload?.runId ?? current?.runId;
    if (!sessionKey || !runId) {
      return current ? { ...current, activity, ...extra } : undefined;
    }
    const sameRun = current?.sessionKey === sessionKey && current.runId === runId;
    return {
      sessionKey,
      runId,
      startedAt: sameRun ? current.startedAt : Date.now(),
      cancelRequested: sameRun ? current.cancelRequested : undefined,
      activity,
      ...extra,
    };
  }

  private shouldClearActiveRun(payload: { sessionKey?: string; runId?: string } | undefined): boolean {
    const current = this.status.activeRun;
    if (!current) {
      return true;
    }
    return (!payload?.sessionKey || payload.sessionKey === current.sessionKey) && (!payload?.runId || payload.runId === current.runId);
  }

  private isUnsupportedRpc(error: unknown): boolean {
    const code = error instanceof GatewayRequestError ? error.gatewayCode.toUpperCase() : "";
    const message = error instanceof Error ? error.message : String(error);
    return ["METHOD_NOT_FOUND", "UNKNOWN_METHOD", "UNIMPLEMENTED", "NOT_FOUND", "UNSUPPORTED"].includes(code) || /method.*not found|unknown method|not implemented|unsupported/i.test(message);
  }

  private setStatus(status: Partial<GatewayStatus>): void {
    this.status = { ...this.status, ...status, url: this.options.settings.gatewayUrl || DEFAULT_URL };
    this.emit("status", this.status);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopped) {
      return;
    }
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 30000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.setStatus({ state: "connecting", detail: "Reconnecting" });
      this.openSocket();
    }, delay);
  }

  private startTickWatch(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
    }
    this.lastTick = Date.now();
    this.tickTimer = setInterval(() => {
      if (this.lastTick && Date.now() - this.lastTick > this.tickIntervalMs * 2) {
        this.ws?.close(4000, "tick timeout");
      }
    }, Math.max(this.tickIntervalMs, 1000));
  }

  private armChallengeTimeout(): void {
    this.clearChallengeTimer();
    this.challengeTimer = setTimeout(() => {
      if (!this.connectSent) {
        this.ws?.close(1008, "connect challenge timeout");
      }
    }, 10000);
  }

  private clearChallengeTimer(): void {
    if (this.challengeTimer) {
      clearTimeout(this.challengeTimer);
      this.challengeTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearChallengeTimer();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private flushPending(error: Error): void {
    for (const [, pending] of this.pending) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pending.reject(error);
    }
    this.pending.clear();
  }

  private handleConnectError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.setStatus({ state: "error", detail: message });
    this.emit("connect-error", message);
  }

  private identityPath(): string {
    return path.join(this.options.userData, "gateway-device.json");
  }

  private tokenPath(): string {
    return path.join(this.options.userData, "gateway-device-token.json");
  }

  private loadOrCreateDeviceIdentity(): DeviceIdentity {
    const identityPath = this.identityPath();
    try {
      const parsed = JSON.parse(fs.readFileSync(identityPath, "utf8")) as DeviceIdentity;
      if (parsed.deviceId && parsed.privateKeyPem && parsed.publicKeyPem) {
        return parsed;
      }
    } catch {}
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKeyDer = publicKey.export({ type: "spki", format: "der" }) as Buffer;
    const raw = publicKeyDer.subarray(publicKeyDer.length - 32);
    const deviceId = createHash("sha256").update(raw).digest("hex");
    const identity = { deviceId, publicKeyPem, privateKeyPem };
    fs.mkdirSync(path.dirname(identityPath), { recursive: true });
    fs.writeFileSync(identityPath, JSON.stringify(identity, null, 2));
    return identity;
  }

  private publicKeyRawBase64Url(): string {
    const der = createPublicKey(this.device.publicKeyPem).export({ type: "spki", format: "der" }) as Buffer;
    return der.subarray(der.length - 32).toString("base64url");
  }

  private loadDeviceToken(): void {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.tokenPath(), "utf8")) as { token?: string; scopes?: string[] };
      this.deviceToken = parsed.token;
      this.storedScopes = parsed.scopes;
    } catch {}
  }

  private saveDeviceToken(): void {
    fs.mkdirSync(path.dirname(this.tokenPath()), { recursive: true });
    fs.writeFileSync(this.tokenPath(), JSON.stringify({ token: this.deviceToken, scopes: this.storedScopes }, null, 2));
  }
}

