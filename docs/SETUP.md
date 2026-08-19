# Setup and development

## 1. Prepare WSL

Install WSL2 and a supported Ubuntu distribution, then install OpenClaw inside that distribution. From PowerShell:

```powershell
wsl -d Ubuntu -- bash -ilc "command -v openclaw"
wsl -d Ubuntu -- bash -ilc "openclaw doctor"
wsl -d Ubuntu -- bash -ilc "openclaw gateway status"
```

The first command must report success. OpenClaw Desktop uses a login shell for reviewed OpenClaw commands so user PATH setup is applied.

## 2. Install project dependencies

```powershell
git clone https://github.com/AntonIlin17/openclawUI.git
cd openclawUI
npm ci
```

Use `npm ci`, not `npm install`, in CI and verification workflows so `package-lock.json` remains authoritative.

## 3. Run locally

```powershell
npm run dev:electron
```

The Vite server binds to `127.0.0.1`; the Electron window accepts IPC only from that exact development origin.

## 4. Configure the app

- Gateway URL: a loopback or private-network `ws://`/`wss://` address.
- WSL distro: letters, numbers, dots, underscores, and hyphens only.
- Gateway command: fixed to `openclaw gateway start`.
- Local model service: none, or the reviewed `ollama serve` option.
- Authentication: auto, none, token, or password.
- Windows file access: existing absolute drive paths selected by the user.

Token and password fields are write-only from the renderer. A blank field preserves an existing protected value unless **Clear saved…** is selected.

## 5. Verify

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm audit
```

Or run the combined command:

```powershell
npm run verify
```

## 6. Packaging smoke test

```powershell
npm run package:smoke
```

This creates an unpacked app under `release/win-unpacked` and never publishes. CI performs the same smoke test on `windows-latest`.

## 7. Installer and release

```powershell
npm run dist
```

This produces an unsigned NSIS installer. Do not run `npm run release` without explicit release approval, a reviewed version bump/changelog, passing CI, and a configured GitHub token. Generated `dist/` and `release/` content is ignored and must not be committed.
