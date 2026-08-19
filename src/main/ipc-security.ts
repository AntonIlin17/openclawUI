import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IpcMainInvokeEvent } from "electron";

export function assertTrustedIpcSender(
  event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">,
  options: { rendererDirectory: string; devServerUrl?: string },
): void {
  const senderUrl = event.senderFrame?.url || event.sender.getURL();
  if (!isTrustedRendererUrl(senderUrl, options)) {
    throw new Error("Rejected IPC from an untrusted renderer");
  }
}

export function isTrustedRendererUrl(
  senderUrl: string,
  options: { rendererDirectory: string; devServerUrl?: string },
): boolean {
  let url: URL;
  try {
    url = new URL(senderUrl);
  } catch {
    return false;
  }
  if (options.devServerUrl) {
    try {
      const devOrigin = new URL(options.devServerUrl).origin;
      if ((url.protocol === "http:" || url.protocol === "https:") && url.origin === devOrigin) {
        return true;
      }
    } catch {}
  }
  if (url.protocol !== "file:") {
    return false;
  }
  try {
    const candidate = path.resolve(fileURLToPath(url));
    const root = path.resolve(options.rendererDirectory);
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  } catch {
    return false;
  }
}

export function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
