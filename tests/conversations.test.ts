import assert from "node:assert/strict";
import { test } from "node:test";
import { createConversationSession } from "../src/main/conversations.js";

test("multiple new conversations use unique keys without reusing a gateway label", async () => {
  const calls: Array<{ method: string; params: any }> = [];
  const gateway = {
    async request<T>(method: string, params: any): Promise<T> {
      calls.push({ method, params });
      return { key: `agent:main:${params.key}` } as T;
    },
  };
  const first = await createConversationSession(gateway, "main");
  const second = await createConversationSession(gateway, "main");
  assert.notEqual(first.key, second.key);
  assert(
    calls.every(
      (call) => call.method === "sessions.create" && !("label" in call.params),
    ),
  );
});

test("new conversations explicitly use the chosen local model on the canonical session key", async () => {
  const calls: Array<{ method: string; params: any }> = [];
  const gateway = {
    async request<T>(method: string, params: any): Promise<T> {
      calls.push({ method, params });
      return (
        method === "sessions.create"
          ? { session: { key: "canonical-key" } }
          : {}
      ) as T;
    },
  };
  const result = await createConversationSession(
    gateway,
    "main",
    "ollama/qwen3.5:9b",
  );
  assert.deepEqual(calls[1], {
    method: "sessions.patch",
    params: { key: "canonical-key", model: "ollama/qwen3.5:9b" },
  });
  assert.equal(result.model, "ollama/qwen3.5:9b");
  assert.equal(result.key, "canonical-key");
});
