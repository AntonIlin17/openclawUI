import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { GatewayClient, nextReconnectBackoff } from "../src/main/gateway-client.js";
import { DEFAULT_SETTINGS } from "../src/main/settings.js";
import type { GatewayStatus } from "../src/shared/types.js";
import type { SecretProtector } from "../src/main/secure-storage.js";

const protector: SecretProtector = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`protected:${value}`),
  decryptString: (value) => value.toString().slice(10),
};

test("reconnect backoff is bounded and jittered", () => {
  assert.deepEqual(nextReconnectBackoff(1000, () => 0), { delayMs: 800, nextMs: 2000 });
  assert.deepEqual(nextReconnectBackoff(20_000, () => 1), { delayMs: 24_000, nextMs: 30_000 });
  assert.deepEqual(nextReconnectBackoff(60_000, () => 0.5), { delayMs: 30_000, nextMs: 30_000 });
});

test("gateway lifecycle correlates reversed responses, reconnects, and protects device tokens", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-gateway-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  assert.equal(typeof address, "object");
  const port = (address as { port: number }).port;
  let connectionCount = 0;
  const requests: Array<{ socket: WebSocket; frame: { id: string; method: string } }> = [];

  server.on("connection", (socket) => {
    connectionCount += 1;
    socket.send(JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: `nonce-${connectionCount}` } }));
    socket.on("message", (raw) => {
      const frame = JSON.parse(raw.toString()) as { id: string; method: string };
      if (frame.method === "connect") {
        socket.send(JSON.stringify({
          type: "res",
          id: frame.id,
          ok: true,
          payload: { auth: { deviceToken: "device-token-secret", scopes: ["operator.admin"] }, policy: { tickIntervalMs: 30_000 } },
        }));
        return;
      }
      requests.push({ socket, frame });
      if (requests.length === 2) {
        for (const request of [...requests].reverse()) {
          request.socket.send(JSON.stringify({ type: "res", id: request.frame.id, ok: true, payload: { method: request.frame.method } }));
        }
      }
    });
  });

  const client = new GatewayClient({
    userData: directory,
    settings: { ...DEFAULT_SETTINGS, gatewayUrl: `ws://127.0.0.1:${port}`, port },
    secretProtector: protector,
    version: "test",
  });
  context.after(() => {
    client.stop();
    server.close();
  });

  client.start();
  client.start();
  await waitForStatus(client, (status) => status.state === "idle");
  assert.equal(connectionCount, 1, "start() is idempotent while a socket is active");

  const one = client.request<{ method: string }>("request.one");
  const two = client.request<{ method: string }>("request.two");
  assert.equal((await one).method, "request.one");
  assert.equal((await two).method, "request.two");

  const tokenFile = fs.readFileSync(path.join(directory, "gateway-device-token.json"), "utf8");
  const identityFile = fs.readFileSync(path.join(directory, "gateway-device.json"), "utf8");
  assert.doesNotMatch(tokenFile, /device-token-secret/);
  assert.doesNotMatch(identityFile, /PRIVATE KEY/);

  for (const socket of server.clients) socket.close(1012, "restart test");
  await waitUntil(() => connectionCount >= 2, 5000);
  await waitForStatus(client, (status) => status.state === "idle");
  client.stop();
  assert.equal(client.getStatus().state, "disconnected");
});

async function waitForStatus(client: GatewayClient, predicate: (status: GatewayStatus) => boolean): Promise<void> {
  if (predicate(client.getStatus())) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.off("status", listener);
      reject(new Error(`Timed out waiting for gateway status; last state: ${client.getStatus().state}`));
    }, 5000);
    const listener = (status: GatewayStatus) => {
      if (!predicate(status)) return;
      clearTimeout(timeout);
      client.off("status", listener);
      resolve();
    };
    client.on("status", listener);
  });
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
