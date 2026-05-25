import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import type { AppSettings } from "../shared/types.js";

const DEFAULT_SETTINGS: AppSettings = {
  gatewayUrl: "ws://127.0.0.1:18789",
  host: "127.0.0.1",
  port: 18789,
  wslDistro: "Ubuntu",
  gatewayCommand: "openclaw gateway start",
  authMode: "auto",
  autostart: false,
  fileAccessPaths: ["C:\\"],
  thinking: "brief",
};

type StoredSettings = Omit<AppSettings, "token" | "password"> & {
  token?: string;
  password?: string;
};

export class SettingsStore {
  constructor(private userData = app.getPath("userData")) {}

  get settingsPath(): string {
    return path.join(this.userData, "settings.json");
  }

  load(): AppSettings {
    let stored: Partial<StoredSettings> = {};
    try {
      stored = JSON.parse(fs.readFileSync(this.settingsPath, "utf8")) as Partial<StoredSettings>;
    } catch {}
    const merged = { ...DEFAULT_SETTINGS, ...stored };
    merged.gatewayUrl = merged.gatewayUrl || `ws://${merged.host}:${merged.port}`;
    return {
      ...merged,
      token: this.decrypt(stored.token),
      password: this.decrypt(stored.password),
    };
  }

  save(settings: AppSettings): AppSettings {
    const stored: StoredSettings = {
      ...settings,
      gatewayUrl: settings.gatewayUrl || `ws://${settings.host}:${settings.port}`,
      token: this.encrypt(settings.token),
      password: this.encrypt(settings.password),
    };
    fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true });
    fs.writeFileSync(this.settingsPath, JSON.stringify(stored, null, 2));
    return this.load();
  }

  merge(settings: Partial<AppSettings>): AppSettings {
    return this.save({ ...this.load(), ...settings });
  }

  private encrypt(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }
    try {
      if (safeStorage.isEncryptionAvailable()) {
        return `safe:${safeStorage.encryptString(value).toString("base64")}`;
      }
    } catch {}
    return value;
  }

  private decrypt(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }
    if (!value.startsWith("safe:")) {
      return value;
    }
    try {
      return safeStorage.decryptString(Buffer.from(value.slice(5), "base64"));
    } catch {
      return undefined;
    }
  }
}
