# OpenClaw Desktop: from working prototype to defensible desktop product

## Context

OpenClaw Desktop is a Windows Electron client for interacting with a local OpenClaw gateway inside WSL. The existing application already demonstrated its core workflow, but its renderer/main boundary, diagnostic surface, credential storage, recovery experience, automated checks, and project documentation needed the rigor expected of a public desktop product.

The work began by locating and preserving the newest user-accessible source, then comparing its Git identity with the public repository. The selected source and the public default branch shared the same commit and tree, so the professionalization could proceed on a feature branch without rewriting the existing `v0.1.1` or `v0.1.2` history.

## Security boundary

Electron's main process now treats every renderer request as untrusted input. IPC calls pass sender checks and runtime schemas before they reach settings, filesystem, export, model, or WSL operations. Paths are normalized and checked against an explicit root, including real-path checks for existing targets. File attachments cross the boundary as short-lived grants rather than renderer-supplied arbitrary paths.

The WSL bridge exposes a closed set of operations. Dynamic values are passed as positional arguments, while command bodies remain application-owned. Gateway URLs are constrained to local/private WebSocket endpoints. The renderer is sandboxed, navigation is blocked, permission requests are denied by default, external links are limited to HTTP(S), and the page ships with a restrictive content security policy.

Diagnostics no longer return a raw OpenClaw configuration document. They report a small allow-listed status model, with recursive key/value redaction and personal-path scrubbing applied before data reaches the renderer or logs. Settings and device credentials are encrypted with Electron `safeStorage` when it is available; the application does not introduce a new plaintext fallback.

## Reliability and product experience

The gateway client gained idempotent start/stop behavior, correlated reverse requests, bounded exponential reconnect backoff with jitter, and clearer state reporting. Automated tests cover those paths along with validation, storage, path conversion and containment, and recursive redaction.

The interface now distinguishes first run, connection in progress, empty content, disconnection, and recoverable failure. Settings communicate that credentials are write-only, show only whether a value is saved, and provide an explicit clear action. Recovery states keep the relevant next action close to the failure rather than leaving the user with an indefinite spinner.

## Delivery discipline

The repository now has one verification command for lint, type checking, tests, and production build. GitHub Actions repeats those checks on Windows and produces an unpacked application for a launch smoke test. The setup, architecture, troubleshooting, security, and limitation documents make the operating assumptions and trust boundaries explicit. Existing release notes remain intact under an Unreleased section.

## Privacy-safe showcase

Every showcase image is a capture of the real React renderer at 1280×720. A development-only synthetic adapter supplies fake gateway, account, model, session, chat, diagnostic, and filesystem information; the production build cannot activate it. The resulting media shows real interaction design without copying local OpenClaw state, usernames, tokens, logs, device identifiers, chats, or paths.

## Result

The project retains the original repository and release lineage while presenting a substantially stronger public engineering story: a deliberately narrow desktop trust boundary, testable failure recovery, repeatable Windows delivery, and a showcase whose claims map to verified code and checks.
