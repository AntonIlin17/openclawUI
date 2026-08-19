import fs from "node:fs";
import path from "node:path";
import type { AppSettings } from "../shared/types.js";
import { parseAppSettings } from "../shared/validation.js";
import { SecretCodec, type SecretProtector } from "./secure-storage.js";

export const DEFAULT_SETTINGS: AppSettings = {
  gatewayUrl: "ws://127.0.0.1:18789",
  host: "127.0.0.1",
  port: 18789,
  wslDistro: "Ubuntu",
  gatewayCommand: "openclaw gateway start",
  modelStartCommand: "",
  autoStartGateway: true,
  authMode: "auto",
  autostart: false,
  fileAccessPaths: [],
  prefetchFileListings: true,
  thinking: "brief",
};

type StoredSettings = Omit<
  AppSettings,
  "token" | "password" | "hasToken" | "hasPassword" | "clearToken" | "clearPassword"
> & {
  token?: string;
  password?: string;
};

export class SettingsStore {
  private readonly codec: SecretCodec;
  private volatileSecrets: Pick<AppSettings, "token" | "password"> = {};

  constructor(private readonly userData: string, protector: SecretProtector) {
    this.codec = new SecretCodec(protector);
  }

  get settingsPath(): string {
    return path.join(this.userData, "settings.json");
  }

  load(): AppSettings {
    let stored: Partial<StoredSettings> = {};
    try {
      stored = JSON.parse(fs.readFileSync(this.settingsPath, "utf8")) as Partial<StoredSettings>;
    } catch {}
    const merged = { ...DEFAULT_SETTINGS, ...stored };
    const candidate = {
      ...merged,
      gatewayUrl: merged.gatewayUrl || `ws://${merged.host}:${merged.port}`,
      token: this.volatileSecrets.token ?? this.codec.decode(stored.token),
      password: this.volatileSecrets.password ?? this.codec.decode(stored.password),
    };
    try {
      return parseAppSettings(candidate);
    } catch {
      return {
        ...DEFAULT_SETTINGS,
        token: candidate.token,
        password: candidate.password,
      };
    }
  }

  save(settings: AppSettings): AppSettings {
    const validated = parseAppSettings(settings, settings);
    this.volatileSecrets = { token: validated.token, password: validated.password };
    const stored: StoredSettings = {
      gatewayUrl: validated.gatewayUrl,
      host: validated.host,
      port: validated.port,
      wslDistro: validated.wslDistro,
      gatewayCommand: validated.gatewayCommand,
      modelStartCommand: validated.modelStartCommand,
      autoStartGateway: validated.autoStartGateway,
      authMode: validated.authMode,
      autostart: validated.autostart,
      fileAccessPaths: validated.fileAccessPaths,
      prefetchFileListings: validated.prefetchFileListings,
      preferredModel: validated.preferredModel,
      thinking: validated.thinking,
      token: this.codec.encode(validated.token),
      password: this.codec.encode(validated.password),
    };
    fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true });
    fs.writeFileSync(this.settingsPath, JSON.stringify(stored, null, 2), { mode: 0o600 });
    try {
      fs.chmodSync(this.settingsPath, 0o600);
    } catch {}
    return this.load();
  }

  merge(settings: Partial<AppSettings>): AppSettings {
    return this.save({ ...this.load(), ...settings });
  }
}
