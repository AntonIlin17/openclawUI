# Troubleshooting

## The app stays on Connecting

1. Open **Settings → Diagnostics & logs**.
2. Confirm the WSL distribution name exactly matches `wsl --list --quiet`.
3. In PowerShell run `wsl -d Ubuntu -- bash -ilc "openclaw gateway status"`.
4. Use **Start Gateway**, then **Reconnect**.

The app first tries the configured local address. When `127.0.0.1` forwarding is unavailable, it can detect the WSL VM address and retry on that private address.

## OpenClaw is not found

OpenClaw must be available to the WSL login shell:

```powershell
wsl -d Ubuntu -- bash -ilc "command -v openclaw"
```

If an interactive shell finds it but this command does not, correct the distribution's login-shell PATH rather than placing an arbitrary command in Desktop settings.

## A dropped file is rejected

Dragged files must be inside a folder saved under **Windows file access**. Add the root, save Settings, and retry. To authorize a single file outside those roots, use the paperclip button and the system picker.

Containment is checked after resolving the path; a junction or symlink that escapes an allowed root is rejected.

## Credentials are not remembered

Open **Diagnostics** and check **encrypted credential storage**. When Electron `safeStorage` is unavailable, the app deliberately keeps new secrets in memory only and will not persist them as plaintext. Correct Windows credential-storage availability, then save the credential again.

## Diagnostics do not show raw command output

This is intentional. Diagnostics report allow-listed success/failure and configuration-presence fields. Run `openclaw doctor` directly in WSL for detailed local output; review it before sharing because it may contain personal information.

## The Windows package shows SmartScreen

Current packages are unsigned. SmartScreen reputation and publisher verification require an appropriate code-signing certificate. Do not disable Windows security controls for distribution; sign release artifacts instead.

## Auto-update fails

Auto-update is available only in installed builds and expects a compatible GitHub Release containing the electron-builder update metadata. Confirm internet access, the public release page, and the app log. Development and unpacked smoke builds do not exercise the complete installed-update path.
