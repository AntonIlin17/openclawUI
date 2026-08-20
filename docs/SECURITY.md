# Security architecture

## Trust assumptions

- The Windows user and selected WSL distribution are trusted local principals.
- Renderer content, Gateway frames, drag/drop data, stored JSON, and IPC arguments are untrusted.
- The Gateway must be local or on a private network address. Public hosts are rejected by settings validation.
- OpenClaw itself and its configuration remain outside this repository and outside Desktop backups/showcase data.

## Controls

- `contextIsolation`, Chromium sandboxing, disabled Node integration/webviews, denied permission requests, CSP, blocked in-app navigation, and external HTTP(S)-only links.
- Frozen preload surface with allow-listed subscriptions.
- Sender-origin checks and bounded runtime schemas on every IPC handler.
- Closed WSL command map; no renderer text is concatenated into a runnable command.
- Absolute-path validation, lexical containment, `realpath` containment, and main-process attachment reconstruction.
- `safeStorage` encryption for settings, device identity, and device tokens; no plaintext persistence fallback.
- Recursive log redaction plus allow-listed diagnostics that omit raw configuration and command output.
- WebSocket payload cap, request timeouts, request correlation, pending-request rejection, tick monitoring, and bounded jittered reconnect.
- Dependency lockfile, zero-known-vulnerability npm audit at verification time, lint/typecheck/tests, and Windows packaging smoke CI.

## Secret migration

v0.1.x may have stored Gateway device identity/token JSON in plaintext and could store settings secrets unencrypted when `safeStorage` was unavailable. The hardened stores recognize legacy values and rewrite them as encrypted envelopes when protected storage is available. New values are never persisted as plaintext.

Users upgrading from v0.1.x should install the hardened build, launch it once with Windows credential storage available, then confirm Diagnostics reports encrypted storage as available. Back up and delete old application data only according to the user's own retention policy; this repository does not automate destructive cleanup.

## Diagnostics contract

Safe diagnostics may disclose app version, platform, WSL distribution label, local Gateway health, configured auth mode, whether a credential exists, whether tools appear enabled, and success/failure booleans. They must not disclose raw OpenClaw JSON, token/password/device-key material, chat content, arbitrary command output, or unredacted user-home paths.

## Release posture

Unsigned artifacts are suitable for local evaluation but do not provide publisher identity. A production release should be code-signed, built by passing CI from a reviewed tag, and accompanied by checksums and an explicit changelog.
