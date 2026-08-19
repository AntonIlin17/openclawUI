import fs from "node:fs";
import path from "node:path";

export type SecretProtector = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};

type SecureEnvelope = {
  version: 1;
  encrypted: string;
};

export function createSecretProtector(storage: SecretProtector): SecretProtector {
  return storage;
}

export class SecretCodec {
  constructor(private readonly protector: SecretProtector) {}

  encode(value?: string): string | undefined {
    if (!value || !this.available()) {
      return undefined;
    }
    return `safe:v1:${this.protector.encryptString(value).toString("base64")}`;
  }

  decode(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }
    if (!value.startsWith("safe:v1:")) {
      return value;
    }
    try {
      return this.protector.decryptString(Buffer.from(value.slice(8), "base64"));
    } catch {
      return undefined;
    }
  }

  available(): boolean {
    try {
      return this.protector.isEncryptionAvailable();
    } catch {
      return false;
    }
  }
}

export class SecureJsonStore<T extends object> {
  private readonly codec: SecretCodec;

  constructor(private readonly filePath: string, protector: SecretProtector) {
    this.codec = new SecretCodec(protector);
  }

  load(): { value: T | null; legacy: boolean } {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as SecureEnvelope | T;
      if (isEnvelope(parsed)) {
        const decoded = this.codec.decode(`safe:v1:${parsed.encrypted}`);
        return { value: decoded ? JSON.parse(decoded) as T : null, legacy: false };
      }
      return { value: parsed as T, legacy: true };
    } catch {
      return { value: null, legacy: false };
    }
  }

  save(value: T): boolean {
    const encoded = this.codec.encode(JSON.stringify(value));
    if (!encoded) {
      return false;
    }
    const envelope: SecureEnvelope = { version: 1, encrypted: encoded.slice(8) };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(envelope, null, 2), { mode: 0o600 });
    try {
      fs.chmodSync(this.filePath, 0o600);
    } catch {}
    return true;
  }

  migrateLegacy(value: T): boolean {
    return this.save(value);
  }
}

function isEnvelope(value: unknown): value is SecureEnvelope {
  return Boolean(
    value
      && typeof value === "object"
      && (value as Record<string, unknown>).version === 1
      && typeof (value as Record<string, unknown>).encrypted === "string",
  );
}
