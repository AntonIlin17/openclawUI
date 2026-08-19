# Changelog

All notable changes are documented here. Release tags `v0.1.1` and `v0.1.2` remain unchanged.

## Unreleased

### Security

- Removed the raw OpenClaw configuration dump from diagnostics.
- Added allow-listed configuration/health summaries and recursive secret/path redaction.
- Added sender verification and bounded runtime validation to every renderer-to-main IPC handler.
- Replaced renderer-controlled WSL command strings with a closed command allow-list.
- Added lexical and `realpath` containment plus main-process attachment grants/reconstruction.
- Enabled renderer sandboxing, CSP, permission denial, navigation blocking, safe external links, and strict Mermaid rendering.
- Protected settings, device identity, and device tokens with `safeStorage`; disabled plaintext fallback persistence.
- Removed an unused vulnerable PDF dependency, upgraded the Electron/build stack, and resolved the npm audit to zero findings.

### Reliability and UX

- Added idempotent Gateway start, request-correlation coverage, pending-request cleanup, bounded reconnect jitter, and current app version in the protocol handshake.
- Added explicit first-run, connecting, loading, empty, error, and recovery UI states.
- Updated drag/drop handling for the current Electron `webUtils.getPathForFile` API.

### Quality and documentation

- Added ESLint, strict type checking, Node integration/unit tests, GitHub Actions, and a Windows packaging smoke job.
- Rewrote README, architecture, setup, troubleshooting, security, limitations, and security-reporting documentation.
- Added MIT licensing, third-party notices, and the portfolio-ready `showcase/` package.

## 0.1.2 — 2026-05-26

- Started OpenClaw through a WSL login shell so the user PATH is loaded.
- Published the `v0.1.2` release.

## 0.1.1 — 2026-05-26

- Added the first tagged OpenClaw Desktop release line.
