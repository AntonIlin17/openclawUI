# Architecture

OpenClaw Desktop is an Electron application with four explicit trust zones.

```text
React renderer (sandboxed)
        │ validated IPC through a frozen preload API
        ▼
Electron main process ──────► Windows dialogs / safeStorage / exports
        │
        ├────────► OpenClaw Gateway WebSocket (local/private address only)
        │
        └────────► wsl.exe argument arrays / reviewed login-shell commands
                            │
                            ▼
                    OpenClaw in WSL2
```

## Renderer

`src/renderer` owns presentation and interaction state. It has no Node integration, runs with Chromium sandboxing and context isolation, and receives a frozen API from `preload.cjs`. The CSP permits bundled assets and local development transport only. Markdown links are restricted to HTTP(S), open outside the app, and never navigate the application document.

First-run, connecting, loading, empty, running, disconnected, and recovery states are represented explicitly. The renderer does not receive stored token/password values; it only receives `hasToken` and `hasPassword` indicators.

## Preload and IPC

The preload exposes narrow request methods and an allow-list of event subscriptions. Each main-process handler:

1. checks the sending frame against the packaged renderer directory or the exact configured development origin;
2. parses `unknown` values with bounded runtime validators;
3. reconstructs sensitive objects such as attachments in the main process; and
4. passes only validated data to the target service.

This boundary is implemented in `src/main/ipc-security.ts` and `src/shared/validation.ts`.

## Gateway client

`src/main/gateway-client.ts` owns the WebSocket lifecycle and protocol correlation map. It performs the challenge/response connection, signs the device assertion, stores protected device credentials, tracks the active run, watches gateway ticks, rejects pending requests on close, and reconnects with exponential backoff plus bounded jitter.

The client emits normalized status and protocol events. `main.ts` converts those events into in-memory chat/tool state and renderer events.

## WSL boundary

`src/main/wsl.ts` always spawns `wsl.exe` with an argument array and `shell: false` (the Node default). Long-running commands are selected from a closed command table. Login-shell execution remains necessary so OpenClaw can be discovered on the WSL user PATH, but renderer text never selects or extends a shell command.

File listing uses direct `find` arguments. Updating the marked `AGENTS.md` section sends base64 content as a positional argument to a static script. Output and execution time are bounded.

## Filesystem boundary

`src/main/path-security.ts` performs Windows normalization, root-relative containment, `realpath` revalidation, and drive-to-WSL conversion. System file-picker selections create exact, in-memory attachment grants. Dragged files must additionally resolve inside a saved folder grant. Renderer-supplied WSL paths are discarded and rebuilt from the authorized Windows path.

## Secrets and diagnostics

Settings use an injected `safeStorage` adapter. Device identity and token files are encrypted envelopes; existing plaintext v0.1.x files migrate when protected storage is available. No plaintext fallback is written.

`src/main/redaction.ts` recursively redacts secret keys and credential-like strings, scrubs common user-home paths, handles cycles, and preserves non-secret metrics such as token counts. Diagnostics log only allow-listed summaries and pass through the same logger redaction pipeline.
