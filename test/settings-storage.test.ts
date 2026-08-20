import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_SETTINGS, SettingsStore } from "../src/main/settings.js";
import { SecureJsonStore, type SecretProtector } from "../src/main/secure-storage.js";

const protector: SecretProtector = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`protected:${value}`, "utf8"),
  decryptString: (value) => {
    const decoded = value.toString("utf8");
    if (!decoded.startsWith("protected:")) throw new Error("invalid ciphertext");
    return decoded.slice(10);
  },
};

test("settings persist secrets only as protected ciphertext", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-settings-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new SettingsStore(directory, protector);
  const saved = store.save({ ...DEFAULT_SETTINGS, authMode: "token", token: "gateway-token-value" });
  assert.equal(saved.token, "gateway-token-value");
  const raw = fs.readFileSync(store.settingsPath, "utf8");
  assert.doesNotMatch(raw, /gateway-token-value/);
  assert.match(raw, /safe:v1:/);
  assert.equal(new SettingsStore(directory, protector).load().token, "gateway-token-value");
});

test("safeStorage-unavailable behavior keeps a secret in memory without writing plaintext", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-settings-unavailable-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const unavailable: SecretProtector = {
    isEncryptionAvailable: () => false,
    encryptString: () => { throw new Error("unavailable"); },
    decryptString: () => { throw new Error("unavailable"); },
  };
  const store = new SettingsStore(directory, unavailable);
  assert.equal(store.save({ ...DEFAULT_SETTINGS, token: "memory-only" }).token, "memory-only");
  assert.doesNotMatch(fs.readFileSync(store.settingsPath, "utf8"), /memory-only/);
  assert.equal(new SettingsStore(directory, unavailable).load().token, undefined);
});

test("legacy device tokens migrate into an encrypted envelope", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-device-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "gateway-device-token.json");
  fs.writeFileSync(file, JSON.stringify({ token: "legacy-device-token", scopes: ["operator.admin"] }));
  const store = new SecureJsonStore<{ token: string; scopes: string[] }>(file, protector);
  const loaded = store.load();
  assert.equal(loaded.legacy, true);
  assert.equal(loaded.value?.token, "legacy-device-token");
  assert.equal(store.migrateLegacy(loaded.value!), true);
  const raw = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(raw, /legacy-device-token/);
  assert.equal(store.load().value?.token, "legacy-device-token");
});
