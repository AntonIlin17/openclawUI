# OpenClaw Desktop

OpenClaw Desktop is a native Windows Electron client for a local OpenClaw Gateway running in WSL2. It connects to the Gateway WebSocket directly and does not wrap or scrape `openclaw tui`.

## Prerequisites

- Windows 10/11
- WSL2 with Ubuntu
- OpenClaw installed inside Ubuntu
- A working Gateway config at `~/.openclaw/openclaw.json`

## Development

```powershell
npm install
npm run generate:icons
npm run dev:electron
```

The app defaults to `ws://127.0.0.1:18789`. If Windows localhost forwarding does not reach WSL, it falls back to the WSL VM IP from `wsl hostname -I`.

## Build Installer

```powershell
npm run generate:icons
npm run dist
```

The NSIS installer is written to `release/`. Code signing placeholders are present in `package.json` via `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`, but signing is optional.

## Gateway Protocol

The client mirrors the OpenClaw TUI path verified from the official docs and source:

- WebSocket JSON frames
- pre-connect `connect.challenge`
- `connect` request with protocol version 4, operator role, admin scope, `tool-events` capability, and signed device identity
- RPCs: `chat.send`, `chat.history`, `sessions.list`, `sessions.create`, `sessions.patch`, `sessions.reset`, `agents.list`, and `models.list`
- events: `chat`, `agent`, `btw`, and `sessions.changed`

## Windows Files From WSL

Windows paths are translated before being referenced in chat:

- `C:\Users\me\file.pdf` -> `/mnt/c/Users/me/file.pdf`
- `D:\data\x.csv` -> `/mnt/d/data/x.csv`

Settings **Windows file access** adds allowed folder roots. Saving settings updates a marked section in `~/.openclaw/AGENTS.md` inside WSL so the agent knows which trees to use. The chat UI shows file-access instructions in a collapsible **Thinking** row (not inside your message bubble).

Optional **prefetch folder listings** runs `find` in WSL when your message mentions an allowed folder, so the agent can summarize even before file tools are configured.

### Enable file tools in OpenClaw (WSL)

1. Confirm the folder is visible: `ls /mnt/c/Users/<you>/path/to/project`
2. Inspect config: `cat ~/.openclaw/openclaw.json`
3. Run: `openclaw doctor`
4. Restart the gateway from OpenClaw Desktop after changing config

The Desktop app does not mount drives itself; WSL already exposes `C:\` as `/mnt/c`.

## Cold start (after reboot or shutdown)

1. Open **OpenClaw Desktop** (or start it from the system tray if you enabled **Launch on startup** in Settings).
2. The app waits for WSL, optionally runs your **Local model command**, then runs **Gateway command** (default `openclaw gateway start`) and connects when the gateway health check passes.
3. If the header still shows **disconnected**, open the tray icon → **Start Gateway**, or Settings → confirm **Start gateway when app opens** is enabled → Save.
4. In WSL you can verify manually: `openclaw gateway status` and `curl -s http://127.0.0.1:18789/healthz`.

If you use a separate local inference server (for example Ollama), set **Local model command** in Settings to something like `ollama serve` so it starts before the gateway.

## Diagnostics & logs

Every boot the app writes a structured log to `%APPDATA%\OpenClaw Desktop\logs\openclaw-desktop.log`. WSL command output, gateway/model process stdout/stderr, gateway connection errors, and auto-updater events all funnel into this file (and into the in-app log viewer).

- **Help → Open log file** / **Open logs folder** — opens the file in your default editor.
- **Settings → Diagnostics & logs** — live tail of the log inside the app with filtering, plus a **Run gateway diagnostics** button that executes `openclaw doctor`, `openclaw gateway status`, a healthz curl, and dumps `~/.openclaw/openclaw.json` into the log.
- If the gateway never comes up at boot, diagnostics auto-run after the warmup timeout and after three consecutive connect errors.

## Auto-update

Installed builds auto-update from GitHub Releases (`AntonIlin17/openclawUI`). On launch the app checks for a newer release in the background, downloads it, and prompts you to restart. **Help → Check for updates** triggers a manual check.

Publishing a new release:

```powershell
# bump version in package.json, then:
$env:GH_TOKEN = "<your github token with repo scope>"
npm run release
```

`electron-builder` will build the NSIS installer, sign nothing (signing is disabled), and publish the installer + `latest.yml` to a new GitHub release. Installed clients pick it up on next launch — no manual uninstall/reinstall needed.

## Tray Behavior

Closing the window minimizes to tray. Use the tray menu to open the app, create a conversation, open history, start/stop/restart the Gateway, open Settings, or Exit fully.
