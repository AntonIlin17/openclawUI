import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { WebSocketServer } from "ws";
import { GatewayClient } from "../src/main/gateway-client.js";
import type { AppSettings } from "../src/shared/types.js";

async function fixture(rejectHandshake = false) {
  const server = new WebSocketServer({ port: 0 });
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const userData = mkdtempSync(path.join(tmpdir(), "openclaw-client-test-"));
  const settings: AppSettings = {
    gatewayUrl: `ws://127.0.0.1:${address.port}`,
    host: "127.0.0.1",
    port: address.port,
    wslDistro: "Ubuntu",
    gatewayCommand: "",
    autoStartGateway: false,
    authMode: "none",
    autostart: false,
    fileAccessPaths: [],
    prefetchFileListings: false,
    thinking: "brief",
  };
  let connections = 0;
  server.on("connection", (socket) => {
    connections++;
    socket.send(
      JSON.stringify({
        type: "event",
        event: "connect.challenge",
        payload: { nonce: "test-nonce" },
      }),
    );
    socket.on("message", (raw) => {
      const frame = JSON.parse(raw.toString());
      if (frame.method === "connect") {
        socket.send(
          JSON.stringify({
            type: "res",
            id: frame.id,
            ok: !rejectHandshake,
            ...(rejectHandshake
              ? {
                  error: {
                    code: "UNAUTHORIZED",
                    message:
                      "Access token is invalid. Update your connection settings.",
                  },
                }
              : { payload: { policy: { tickIntervalMs: 60000 } } }),
          }),
        );
      } else {
        socket.send(
          JSON.stringify({
            type: "res",
            id: frame.id,
            ok: true,
            payload: { agents: [{ id: "main" }] },
          }),
        );
      }
    });
  });
  const client = new GatewayClient({ userData, settings });
  return {
    client,
    get connections() {
      return connections;
    },
    close: async () => {
      client.stop();
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(userData, { recursive: true, force: true });
    },
  };
}

function waitFor(client: GatewayClient, expected: string) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.off("status", listener);
      reject(new Error(`Timed out waiting for ${expected}`));
    }, 4000);
    const listener = (status: { state: string }) => {
      if (status.state === expected) {
        clearTimeout(timeout);
        client.off("status", listener);
        resolve();
      }
    };
    client.on("status", listener);
  });
}

test("completes the challenge handshake and performs a gateway RPC", async () => {
  const f = await fixture();
  try {
    const connected = waitFor(f.client, "idle");
    f.client.start();
    await connected;
    assert.deepEqual(await f.client.request("agents.list", {}), {
      agents: [{ id: "main" }],
    });
  } finally {
    await f.close();
  }
});

test("a replaced socket cannot disconnect the new connection", async () => {
  const f = await fixture();
  try {
    let connected = waitFor(f.client, "idle");
    f.client.start();
    await connected;
    connected = waitFor(f.client, "idle");
    f.client.start();
    await connected;
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(f.client.getStatus().state, "idle");
    assert.deepEqual(await f.client.request("agents.list", {}), {
      agents: [{ id: "main" }],
    });
    assert.equal(f.connections, 2);
  } finally {
    await f.close();
  }
});

test("keeps an actionable authentication error after the socket closes", async () => {
  const f = await fixture(true);
  try {
    const error = waitFor(f.client, "error");
    f.client.start();
    await error;
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(f.client.getStatus().state, "error");
    assert.match(f.client.getStatus().detail ?? "", /Access token is invalid/);
  } finally {
    await f.close();
  }
});
