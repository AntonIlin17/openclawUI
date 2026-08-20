import type { OpenClawDesktopApi } from "../../shared/ipc";
import type { AppSettings, ChatMessage, ConversationSummary, GatewayStatus } from "../../shared/types";

type ShowcaseMode = "cover" | "connection" | "session" | "settings" | "diagnostics";

const fakeSettings: AppSettings = {
  gatewayUrl: "ws://127.0.0.1:18789",
  host: "127.0.0.1",
  port: 18789,
  wslDistro: "Ubuntu",
  gatewayCommand: "openclaw gateway start",
  modelStartCommand: "ollama serve",
  autoStartGateway: true,
  authMode: "token",
  hasToken: true,
  autostart: false,
  fileAccessPaths: ["C:\\OpenClawDemo\\Workspace"],
  prefetchFileListings: true,
  preferredModel: "local/demo-model-7b",
  thinking: "brief",
};

const conversations: ConversationSummary[] = [
  {
    key: "agent:demo:release-review",
    sessionId: "session-demo-001",
    agentId: "demo",
    title: "Release readiness review",
    preview: "Verification is green across the sample workflow.",
    model: "Demo Model 7B",
    provider: "Local Sandbox",
    totalTokens: 342,
    updatedAt: Date.UTC(2026, 7, 19, 16, 20),
  },
  {
    key: "agent:demo:architecture",
    sessionId: "session-demo-002",
    agentId: "demo",
    title: "Architecture notes",
    preview: "Map the desktop trust boundaries.",
    model: "Demo Model 7B",
    provider: "Local Sandbox",
    totalTokens: 218,
    updatedAt: Date.UTC(2026, 7, 18, 13, 10),
  },
  {
    key: "agent:demo:onboarding",
    sessionId: "session-demo-003",
    agentId: "demo",
    title: "First-run checklist",
    preview: "Confirm the synthetic local Gateway setup.",
    model: "Demo Model 7B",
    provider: "Local Sandbox",
    totalTokens: 126,
    updatedAt: Date.UTC(2026, 7, 17, 9, 45),
  },
];

const messages: ChatMessage[] = [
  {
    id: "demo-user-1",
    role: "user",
    content: "Review the sample desktop release workflow and summarize the strongest evidence.",
    createdAt: Date.UTC(2026, 7, 19, 16, 21),
    attachments: [{
      id: "fake-attachment-1",
      name: "sample-verification.json",
      type: "json",
      windowsPath: "C:\\OpenClawDemo\\Workspace\\sample-verification.json",
      wslPath: "/mnt/c/OpenClawDemo/Workspace/sample-verification.json",
    }],
  },
  {
    id: "demo-thinking-1",
    role: "thinking",
    content: "Reviewed synthetic verification results and the documented trust boundaries. No real account, session, path, log, or credential data is present.",
    thinkingLabel: "Reviewing sample evidence",
    createdAt: Date.UTC(2026, 7, 19, 16, 21, 1),
  },
  {
    id: "demo-tool-1",
    role: "tool",
    content: "{\n  \"lint\": \"passed\",\n  \"typecheck\": \"passed\",\n  \"tests\": \"16 passed\",\n  \"audit\": \"0 findings\"\n}",
    toolName: "read_sample_verification",
    toolResult: { lint: "passed", typecheck: "passed", tests: "16 passed", audit: "0 findings" },
    createdAt: Date.UTC(2026, 7, 19, 16, 21, 2),
  },
  {
    id: "demo-assistant-1",
    role: "assistant",
    content: [
      "### Release evidence",
      "",
      "The sample workflow is strongest where it turns security claims into repeatable checks:",
      "",
      "- **Boundary validation:** renderer IPC, paths, and WSL commands are constrained before use.",
      "- **Credential safety:** protected storage and recursive redaction have dedicated tests.",
      "- **Release confidence:** lint, type checking, integration tests, dependency audit, and Windows packaging all pass.",
      "",
      "> Result: a portfolio-ready local desktop client with explicit limitations and a reviewable release path.",
    ].join("\n"),
    createdAt: Date.UTC(2026, 7, 19, 16, 21, 3),
  },
];

const diagnosticEntries = [
  { ts: "2026-08-19T16:25:00.000Z", level: "info" as const, scope: "diag", message: "OpenClaw configuration summary", data: { readable: true, gateway: { authMode: "token", tokenConfigured: true }, tools: { enabled: true } } },
  { ts: "2026-08-19T16:25:00.100Z", level: "info" as const, scope: "diag", message: "openclaw doctor", data: { ok: true } },
  { ts: "2026-08-19T16:25:00.200Z", level: "info" as const, scope: "diag", message: "openclaw gateway status", data: { ok: true } },
  { ts: "2026-08-19T16:25:00.300Z", level: "info" as const, scope: "diag", message: "gateway health", data: { ok: true } },
  { ts: "2026-08-19T16:25:00.400Z", level: "info" as const, scope: "diag", message: "encrypted credential storage", data: { available: true } },
];

export function installShowcaseApi(mode: ShowcaseMode): void {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const status: GatewayStatus = mode === "connection"
    ? { state: "disconnected", detail: "Synthetic Gateway paused for recovery demo", url: fakeSettings.gatewayUrl }
    : { state: "idle", detail: "Connected", url: fakeSettings.gatewayUrl, model: "Demo Model 7B", provider: "Local Sandbox", totalTokens: 342 };

  const emit = (channel: string, payload: unknown) => {
    for (const listener of listeners.get(channel) ?? []) listener(payload);
  };

  const api: OpenClawDesktopApi = {
    getSettings: async () => ({ ...fakeSettings }),
    saveSettings: async (next) => ({ settings: { ...next, token: undefined, password: undefined, hasToken: true } }),
    getToolsStatus: async () => ({ toolsEnabled: true }),
    getStatus: async () => ({ ...status }),
    startGateway: async () => ({ state: "connecting", detail: "Starting synthetic Gateway", url: fakeSettings.gatewayUrl }),
    stopGateway: async () => ({ state: "disconnected", detail: "Stopped", url: fakeSettings.gatewayUrl }),
    restartGateway: async () => ({ state: "connecting", detail: "Restarting synthetic Gateway", url: fakeSettings.gatewayUrl }),
    connectGateway: async () => ({ state: "connecting", detail: "Reconnecting", url: fakeSettings.gatewayUrl }),
    listAgents: async () => [{ id: "demo", name: "Demo workspace" }],
    listModels: async () => [{ id: "local/demo-model-7b", name: "Demo Model 7B", provider: "Local Sandbox", contextWindow: 32_000, reasoning: true }],
    listConversations: async () => mode === "cover" || mode === "connection" ? [] : conversations,
    createConversation: async () => conversations[0],
    renameConversation: async () => undefined,
    deleteConversation: async () => undefined,
    loadHistory: async (sessionKey) => {
      window.setTimeout(() => emit("conversation:messages", { sessionKey, messages }), 40);
      return { messages };
    },
    sendMessage: async () => ({ runId: "run-demo-001" }),
    cancelRun: async () => ({ ok: true, message: "Synthetic run cancelled" }),
    translatePath: async () => "/mnt/c/OpenClawDemo/Workspace",
    chooseFileAccessPaths: async () => ["C:\\OpenClawDemo\\Workspace"],
    chooseAttachmentFiles: async () => [],
    orientOpenClaw: async () => undefined,
    exportConversation: async () => null,
    resolveDroppedFiles: async () => [],
    tailLogs: async () => diagnosticEntries,
    openLogsFolder: async () => undefined,
    openLogFile: async () => "",
    getLogsPath: async () => ({ file: "C:\\OpenClawDemo\\logs\\desktop.log", folder: "C:\\OpenClawDemo\\logs" }),
    runDiagnostics: async () => diagnosticEntries,
    checkForUpdates: async () => ({ ok: true, current: "0.1.2", version: "0.1.2" }),
    on: (channel, handler) => {
      const handlers = listeners.get(channel) ?? new Set<(payload: unknown) => void>();
      const listener = handler as (payload: unknown) => void;
      handlers.add(listener);
      listeners.set(channel, handlers);
      if (channel === "app:settings" && (mode === "settings" || mode === "diagnostics")) {
        window.setTimeout(() => listener({ ...fakeSettings }), 120);
      }
      return () => handlers.delete(listener);
    },
  };

  window.openclaw = api;
  document.documentElement.dataset.showcase = mode;
}
