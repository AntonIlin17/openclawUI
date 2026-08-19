const SECRET_KEY = /^(authorization|cookie|setcookie|password|passwd|secret|clientsecret|apikey|accesstoken|refreshtoken|devicetoken|token|privatekey|signature|credential)$/i;
const TOKEN_COUNT_KEY = /^(input|output|total)tokens$/i;

export const REDACTED = "[REDACTED]";

export function redactSensitive(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (depth > 12) {
    return "[TRUNCATED]";
  }
  if (typeof value === "string") {
    return redactString(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[CIRCULAR]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => redactSensitive(item, seen, depth + 1));
  }
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>).slice(0, 200)) {
    const normalized = key.replace(/[^a-z0-9]/gi, "");
    result[key] = SECRET_KEY.test(normalized) && !TOKEN_COUNT_KEY.test(normalized)
      ? REDACTED
      : redactSensitive(nested, seen, depth + 1);
  }
  return result;
}

export function redactString(value: string): string {
  return value
    .replace(/-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----/g, REDACTED)
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, `Bearer ${REDACTED}`)
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g, REDACTED)
    .replace(/\b([A-Za-z0-9_-]{10,})\.([A-Za-z0-9_-]{10,})\.([A-Za-z0-9_-]{10,})\b/g, REDACTED)
    .replace(/([?&](?:token|password|secret|api[_-]?key)=)[^&\s]+/gi, `$1${REDACTED}`)
    .replace(/\b(token|password|secret|api[_-]?key)\s*[:=]\s*([^\s,;]+)/gi, `$1=${REDACTED}`)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${REDACTED}@`)
    .replace(/\b[A-Za-z]:\\Users\\[^\\\s]+/gi, (match) => `${match.slice(0, 9)}[user]`)
    .replace(/\/home\/[^/\s]+/g, "/home/[user]");
}

export function summarizeOpenClawConfig(config: Record<string, unknown> | null): Record<string, unknown> {
  if (!config) {
    return { readable: false };
  }
  const gateway = record(config.gateway);
  const auth = record(gateway.auth);
  const tools = record(config.tools);
  const agent = record(config.agent);
  const agentTools = record(agent.tools);
  const authMode = string(auth.mode) ?? string(gateway.authMode) ?? "unspecified";
  const toolsEnabled = typeof tools.enabled === "boolean"
    ? tools.enabled
    : typeof agentTools.enabled === "boolean"
      ? agentTools.enabled
      : Array.isArray(tools.allow) && tools.allow.length > 0
        ? true
        : null;
  return {
    readable: true,
    gateway: {
      authMode,
      tokenConfigured: Boolean(string(auth.token) ?? string(gateway.token)),
      passwordConfigured: Boolean(string(auth.password) ?? string(gateway.password)),
      portConfigured: typeof gateway.port === "number",
    },
    tools: { enabled: toolsEnabled },
    capabilitiesDeclared: Array.isArray(config.capabilities),
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
