import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { DEFAULT_SETTINGS } from "../src/main/settings.js";
import { isTrustedRendererUrl } from "../src/main/ipc-security.js";
import {
  isIpcEventChannel,
  parseAppSettings,
  parseCancelRunInput,
  parseSendMessageInput,
  ValidationError,
} from "../src/shared/validation.js";

test("settings validation accepts local gateways and preserves an unchanged secret", () => {
  const previous = { ...DEFAULT_SETTINGS, token: "kept-secret" };
  const parsed = parseAppSettings({ ...DEFAULT_SETTINGS, token: "", hasToken: true }, previous);
  assert.equal(parsed.token, "kept-secret");
  assert.equal(parsed.gatewayUrl, "ws://127.0.0.1:18789");
});

test("settings validation clears secrets only with an explicit request", () => {
  const parsed = parseAppSettings(
    { ...DEFAULT_SETTINGS, clearToken: true, token: "" },
    { ...DEFAULT_SETTINGS, token: "old-secret" },
  );
  assert.equal(parsed.token, undefined);
});

test("settings validation rejects renderer-controlled shell and public gateways", () => {
  assert.throws(
    () => parseAppSettings({ ...DEFAULT_SETTINGS, gatewayCommand: "openclaw gateway start; curl attacker" }),
    ValidationError,
  );
  assert.throws(
    () => parseAppSettings({ ...DEFAULT_SETTINGS, gatewayUrl: "wss://example.com", host: "example.com" }),
    /localhost or a private network/,
  );
});

test("chat and cancellation payloads are validated at runtime", () => {
  const chat = parseSendMessageInput({ sessionKey: "agent:main:demo", message: "hello", thinking: "brief", attachments: [] });
  assert.equal(chat.message, "hello");
  assert.deepEqual(parseCancelRunInput({ sessionKey: "agent:main:demo", runId: "run-1" }), {
    sessionKey: "agent:main:demo",
    runId: "run-1",
  });
  assert.throws(() => parseSendMessageInput({ sessionKey: "demo", message: "", thinking: "brief", attachments: [] }));
});

test("preload subscriptions and renderer URLs use allow-lists", () => {
  assert.equal(isIpcEventChannel("gateway:status"), true);
  assert.equal(isIpcEventChannel("arbitrary:channel"), false);
  const rendererDirectory = path.resolve("dist/renderer");
  const rendererUrl = new URL(`file:///${path.join(rendererDirectory, "index.html").replaceAll("\\", "/")}`).toString();
  assert.equal(isTrustedRendererUrl(rendererUrl, { rendererDirectory }), true);
  assert.equal(isTrustedRendererUrl("https://example.com/", { rendererDirectory }), false);
  assert.equal(
    isTrustedRendererUrl("http://127.0.0.1:5173/settings", { rendererDirectory, devServerUrl: "http://127.0.0.1:5173" }),
    true,
  );
  assert.equal(
    isTrustedRendererUrl("http://127.0.0.1:5174/", { rendererDirectory, devServerUrl: "http://127.0.0.1:5173" }),
    false,
  );
});
