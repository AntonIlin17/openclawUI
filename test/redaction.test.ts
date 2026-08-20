import test from "node:test";
import assert from "node:assert/strict";
import { REDACTED, redactSensitive, redactString, summarizeOpenClawConfig } from "../src/main/redaction.js";

test("recursive redaction removes nested credentials but preserves token counts", () => {
  const redacted = redactSensitive({
    auth: { token: "gateway-secret", password: "password-secret" },
    inputTokens: 42,
    list: [{ deviceToken: "device-secret" }],
  }) as Record<string, unknown>;
  assert.equal((redacted.auth as Record<string, unknown>).token, REDACTED);
  assert.equal(redacted.inputTokens, 42);
  assert.equal(((redacted.list as Array<Record<string, unknown>>)[0]).deviceToken, REDACTED);
});

test("string redaction removes bearer values, private keys, URL credentials, and user paths", () => {
  const value = redactString([
    "Bearer abcdefghijklmnopqrstuvwxyz",
    "https://person:pass@example.test/path",
    "C:\\Users\\anton\\Documents\\project",
    "/home/example-user/workspace",
    "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
  ].join("\n"));
  assert.doesNotMatch(value, /abcdefghijklmnopqrstuvwxyz|person:pass|\\anton\\|\/anton\/|BEGIN PRIVATE/);
  assert.match(value, /\[REDACTED\]/);
});

test("configuration summaries expose only allow-listed booleans and modes", () => {
  const summary = summarizeOpenClawConfig({
    gateway: { auth: { mode: "token", token: "never-return-this" }, port: 18789 },
    tools: { enabled: true, secretPluginConfig: "hidden" },
    unrelated: { privateKey: "hidden" },
  });
  const json = JSON.stringify(summary);
  assert.equal(summary.readable, true);
  assert.match(json, /tokenConfigured/);
  assert.doesNotMatch(json, /never-return-this|secretPluginConfig|privateKey/);
});
