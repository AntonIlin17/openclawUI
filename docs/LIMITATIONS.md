# Known limitations

- Windows and WSL2 only. Native Linux, macOS, and Windows-without-WSL workflows are not supported.
- The Gateway protocol is integration-tested with a deterministic fake server, but compatibility still depends on the installed OpenClaw protocol version and methods.
- The app starts only the reviewed OpenClaw Gateway command and optional Ollama service. Custom service orchestration belongs outside the renderer.
- Credentials require Electron `safeStorage` for persistence. Without it, secrets are memory-only for the current process.
- File access is limited to Windows drive paths. UNC shares and arbitrary WSL-only paths are not accepted by the Windows path grant UI.
- Chat history is held in renderer/main memory after retrieval; the authoritative session history remains in the Gateway.
- PDF export intentionally supports a basic Markdown subset rather than full visual parity with the chat renderer.
- Auto-update requires an installed, compatible electron-builder release artifact. It is not fully exercised by the unpacked CI smoke test.
- Current Windows artifacts are unsigned and may trigger SmartScreen.
- The renderer bundle includes rich Markdown/diagram tooling and remains relatively large; diagrams are rendered with Mermaid strict security mode.
