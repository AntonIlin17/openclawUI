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

Settings includes a file-access section that appends guidance to `~/.openclaw/AGENTS.md`, reminding OpenClaw that Windows drives are mounted under `/mnt/<drive>/`.

## Tray Behavior

Closing the window minimizes to tray. Use the tray menu to open the app, create a conversation, open history, start/stop/restart the Gateway, open Settings, or Exit fully.
