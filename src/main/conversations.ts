import { randomUUID } from "node:crypto";

type GatewayRpc = {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
};

export async function createConversationSession(
  gateway: GatewayRpc,
  agentId: string,
  model?: string,
): Promise<Record<string, unknown>> {
  const localKey = `desktop-${randomUUID()}`;
  // Gateway labels are unique. Reusing "New conversation" as a label prevents
  // every conversation after the first one from being created.
  const result = await gateway.request<Record<string, unknown>>(
    "sessions.create",
    { agentId, key: localKey },
  );
  const nested =
    result.session && typeof result.session === "object"
      ? (result.session as Record<string, unknown>)
      : {};
  const key = String(
    result.key ??
      result.sessionKey ??
      nested.key ??
      `agent:${agentId}:${localKey}`,
  );
  if (model) await gateway.request("sessions.patch", { key, model });
  return {
    ...result,
    key,
    agentId,
    ...(model ? { model, provider: "ollama" } : {}),
  };
}
