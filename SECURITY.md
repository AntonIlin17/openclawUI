# Security policy

## Supported versions

Security fixes are applied to the current default branch and the newest explicitly published release. Historical `v0.1.1` and `v0.1.2` remain available for provenance but should not be assumed to receive backports.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for `AntonIlin17/openclawUI` when available. If private reporting is unavailable, contact the repository owner privately before opening a public issue.

Include:

- affected commit or release;
- reproduction steps using fake credentials/data;
- impact and affected trust boundary;
- whether the issue reaches the renderer, IPC, filesystem, WSL, Gateway, updater, or stored credentials; and
- a suggested remediation, if known.

Do not include real OpenClaw tokens, device keys, configuration files, chats, logs, databases, or personal paths in the report. Allow reasonable time for triage and remediation before public disclosure.

## Scope notes

OpenClaw Desktop is a local client. Vulnerabilities in OpenClaw itself, a WSL distribution, Windows, Electron, or a third-party service should also be reported to the responsible upstream project.
