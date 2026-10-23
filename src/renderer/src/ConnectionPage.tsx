import React, { useEffect, useState } from "react";
import {
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  FolderOpen,
  LoaderCircle,
  Monitor,
  Plus,
  RefreshCw,
  Settings2,
  Wifi,
  X,
} from "lucide-react";
import type { AppSettings, GatewayStatus } from "../../shared/types";
import type { SetupStatus } from "../../shared/ipc";
import { DiagnosticsPanel } from "./Diagnostics";

export function ConnectionPage(p: {
  settings: AppSettings | null;
  status: GatewayStatus;
  onSaved: (settings: AppSettings) => void;
  onError: (error: string) => void;
  onGoChat: () => void;
}) {
  const [draft, setDraft] = useState(p.settings);
  const [tab, setTab] = useState<"connection" | "folders" | "advanced">(
    "connection",
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const connected = ["connected", "idle", "running", "streaming"].includes(
    p.status.state,
  );
  useEffect(() => setDraft(p.settings), [p.settings]);
  useEffect(() => {
    void checkSetup();
  }, []);

  async function checkSetup() {
    setChecking(true);
    try {
      setSetup(await window.openclaw.getSetupStatus());
    } catch (e) {
      p.onError(
        `Couldn't check local services. ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setChecking(false);
    }
  }
  async function connect() {
    setBusy("connect");
    setNotice(null);
    try {
      await window.openclaw.startGateway();
      await checkSetup();
    } catch (e) {
      p.onError(
        `Couldn't start the assistant. ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setBusy(null);
    }
  }
  async function save() {
    if (!draft) return;
    setBusy("save");
    setNotice(null);
    try {
      const url = new URL(draft.gatewayUrl);
      if (!["ws:", "wss:"].includes(url.protocol))
        throw new Error("Use an address beginning with ws:// or wss://.");
      const port = Number(url.port || (url.protocol === "wss:" ? 443 : 80));
      const result = await window.openclaw.saveSettings({
        ...draft,
        host: url.hostname,
        port,
      });
      p.onSaved(result.settings);
      setNotice(
        result.orientError
          ? `Settings saved. Folder guidance could not update: ${result.orientError}`
          : "Settings saved. Your assistant will reconnect with these settings.",
      );
    } catch (e) {
      p.onError(
        `Couldn't save settings. ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setBusy(null);
    }
  }
  async function folders() {
    if (!draft) return;
    try {
      const paths = await window.openclaw.chooseFileAccessPaths();
      setDraft({
        ...draft,
        fileAccessPaths: [...new Set([...draft.fileAccessPaths, ...paths])],
      });
    } catch (e) {
      p.onError(String(e));
    }
  }
  if (!draft)
    return (
      <div className="page-content">
        <LoaderCircle className="spin" size={20} />
        <p>Loading your connection settings…</p>
      </div>
    );
  return (
    <div className="page-scroll">
      <div className="page-content connection-page">
        <div className="page-eyebrow">CONNECTION & SETTINGS</div>
        <h1>
          Let’s get you
          <br />
          <span className="accent-text">connected.</span>
        </h1>
        <p className="page-lead">
          Your model and tools run locally. Here’s how they fit together.
        </p>
        <div className="service-grid">
          <Service
            icon={Monitor}
            title="Desktop workspace"
            detail="You’re here. Everything starts in this app."
            state="ready"
            label="Ready"
          />
          <Service
            icon={Bot}
            title="Ollama · AI model"
            detail={setup?.configuredModel ?? "Runs your local language model."}
            state={setup?.ollamaReachable ? "ready" : "waiting"}
            label={
              checking
                ? "Checking…"
                : setup?.ollamaReachable
                  ? "Available"
                  : setup
                    ? "Not detected"
                    : "Not checked"
            }
          />
          <Service
            icon={Wifi}
            title="OpenClaw · tools"
            detail={
              connected
                ? "Your assistant is connected and ready."
                : "Connects the model to your configured tools."
            }
            state={connected ? "ready" : "waiting"}
            label={
              connected
                ? "Connected"
                : p.status.state === "connecting"
                  ? "Connecting…"
                  : "Needs connection"
            }
          />
        </div>
        <div className={`connection-callout ${connected ? "success" : ""}`}>
          <div className="callout-icon">
            {connected ? (
              <Check size={21} />
            ) : busy === "connect" ? (
              <LoaderCircle className="spin" size={21} />
            ) : (
              <CircleAlert size={21} />
            )}
          </div>
          <div>
            <strong>
              {connected
                ? "You’re ready to start."
                : busy === "connect"
                  ? "Starting your local assistant…"
                  : "Your assistant isn’t connected yet."}
            </strong>
            <p>
              {connected
                ? "Open a conversation or attach a file to get started."
                : busy === "connect"
                  ? "We’re starting OpenClaw in Ubuntu and checking the connection. This can take up to 90 seconds."
                  : "Keep Ollama open, then connect below. You don’t need to use the OpenClaw tile inside Ollama."}
            </p>
            {!connected && p.status.detail ? (
              <details className="connection-detail">
                <summary>Connection details</summary>
                <code>{p.status.detail}</code>
              </details>
            ) : null}
          </div>
          <button
            className="primary-button"
            disabled={!!busy}
            onClick={connected ? p.onGoChat : () => void connect()}
          >
            {connected
              ? "Open conversations"
              : busy === "connect"
                ? "Connecting…"
                : "Connect assistant"}
            {connected ? <ArrowRight size={16} /> : <Wifi size={16} />}
          </button>
        </div>
        <div
          className="settings-tabs"
          role="tablist"
          aria-label="Settings sections"
        >
          {(
            [
              ["connection", "Connection"],
              ["folders", "Folder access"],
              ["advanced", "Advanced & diagnostics"],
            ] as const
          ).map(([id, label]) => (
            <button
              id={`tab-${id}`}
              key={id}
              role="tab"
              aria-selected={tab === id}
              aria-controls="settings-content"
              tabIndex={tab === id ? 0 : -1}
              onKeyDown={(e) => {
                const ids = ["connection", "folders", "advanced"] as const;
                if (
                  ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                ) {
                  e.preventDefault();
                  const index =
                    e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? 2
                        : (ids.indexOf(tab) +
                            (e.key === "ArrowRight" ? 1 : 2)) %
                          3;
                  setTab(ids[index]);
                  document.getElementById(`tab-${ids[index]}`)?.focus();
                }
              }}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <section
          className="settings-card"
          id="settings-content"
          role="tabpanel"
          aria-labelledby={`tab-${tab}`}
        >
          {tab === "connection" ? (
            <>
              <div className="section-heading">
                <div>
                  <h2>Connect to OpenClaw</h2>
                  <p>The defaults work for a local installation in Ubuntu.</p>
                </div>
                <button
                  className="text-button"
                  onClick={() => void checkSetup()}
                  disabled={checking}
                >
                  <RefreshCw size={14} className={checking ? "spin" : ""} />{" "}
                  Check services
                </button>
              </div>
              <div className="settings-grid">
                <label>
                  Connection address
                  <input
                    aria-label="Connection address"
                    value={draft.gatewayUrl}
                    onChange={(e) =>
                      setDraft({ ...draft, gatewayUrl: e.target.value })
                    }
                  />
                  <small>Default: ws://127.0.0.1:18789</small>
                </label>
                <label>
                  Ubuntu distribution
                  <input
                    value={draft.wslDistro}
                    onChange={(e) =>
                      setDraft({ ...draft, wslDistro: e.target.value })
                    }
                  />
                  <small>
                    The WSL distribution where OpenClaw is installed.
                  </small>
                </label>
              </div>
              <div className="setting-toggle">
                <div>
                  <strong>Start OpenClaw when this app opens</strong>
                  <p>No need to open a terminal each time.</p>
                </div>
                <input
                  aria-label="Start OpenClaw when this app opens"
                  type="checkbox"
                  checked={draft.autoStartGateway}
                  onChange={(e) =>
                    setDraft({ ...draft, autoStartGateway: e.target.checked })
                  }
                />
              </div>
              <div className="setting-toggle">
                <div>
                  <strong>Launch at Windows sign-in</strong>
                  <p>
                    Closing the window keeps the app in the tray. Use its tray
                    menu to quit.
                  </p>
                </div>
                <input
                  aria-label="Launch at Windows sign-in"
                  type="checkbox"
                  checked={draft.autostart}
                  onChange={(e) =>
                    setDraft({ ...draft, autostart: e.target.checked })
                  }
                />
              </div>
              <details className="advanced-disclosure">
                <summary>
                  Authentication <ChevronDown size={15} />
                </summary>
                <p>
                  Detected from your local OpenClaw configuration when possible.
                </p>
                <div className="settings-grid">
                  <label>
                    Authentication method
                    <select
                      value={draft.authMode}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          authMode: e.target.value as AppSettings["authMode"],
                        })
                      }
                    >
                      <option value="auto">Automatic</option>
                      <option value="token">Token</option>
                      <option value="password">Password</option>
                      <option value="none">None</option>
                    </select>
                  </label>
                  {draft.authMode === "token" ? (
                    <label>
                      Access token
                      <input
                        autoComplete="off"
                        type="password"
                        value={draft.token ?? ""}
                        onChange={(e) =>
                          setDraft({ ...draft, token: e.target.value })
                        }
                      />
                    </label>
                  ) : null}
                  {draft.authMode === "password" ? (
                    <label>
                      Password
                      <input
                        autoComplete="off"
                        type="password"
                        value={draft.password ?? ""}
                        onChange={(e) =>
                          setDraft({ ...draft, password: e.target.value })
                        }
                      />
                    </label>
                  ) : null}
                </div>
              </details>
            </>
          ) : null}
          {tab === "folders" ? (
            <>
              <h2>Give your assistant a starting point.</h2>
              <p>
                Add folders you want to refer to in conversations. Saving writes
                folder guidance for OpenClaw; actual access depends on its
                tools.
              </p>
              <div className="folder-list">
                {draft.fileAccessPaths.map((path) => (
                  <div className="folder-item" key={path}>
                    <FolderOpen size={18} />
                    <span>{path}</span>
                    <button
                      className="icon-button"
                      title={`Remove ${path}`}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          fileAccessPaths: draft.fileAccessPaths.filter(
                            (item) => item !== path,
                          ),
                        })
                      }
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
              {!draft.fileAccessPaths.length ? (
                <div className="folder-empty">
                  <FolderOpen size={23} />
                  <span>No folders added yet.</span>
                </div>
              ) : null}
              <button
                className="secondary-button"
                onClick={() => void folders()}
              >
                <Plus size={16} /> Add folders
              </button>
              <div className="setting-toggle">
                <div>
                  <strong>Include a folder overview in requests</strong>
                  <p>
                    Give your assistant a short listing when you mention an
                    added folder.
                  </p>
                </div>
                <input
                  aria-label="Include a folder overview in requests"
                  type="checkbox"
                  checked={draft.prefetchFileListings}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      prefetchFileListings: e.target.checked,
                    })
                  }
                />
              </div>
              <p className="caption">
                Folder guidance does not restrict all other filesystem access.
                Review file operations before asking your assistant to apply
                them.
              </p>
            </>
          ) : null}
          {tab === "advanced" ? (
            <>
              <h2>Advanced settings</h2>
              <p>Most people can leave these at their defaults.</p>
              <div className="settings-grid">
                <label>
                  OpenClaw start command
                  <input
                    value={draft.gatewayCommand}
                    onChange={(e) =>
                      setDraft({ ...draft, gatewayCommand: e.target.value })
                    }
                  />
                </label>
                <label>
                  Local model start command (optional)
                  <input
                    value={draft.modelStartCommand ?? ""}
                    placeholder="Leave empty for Windows Ollama"
                    onChange={(e) =>
                      setDraft({ ...draft, modelStartCommand: e.target.value })
                    }
                  />
                  <small>Runs inside Ubuntu, not Windows.</small>
                </label>
                <label>
                  Reasoning detail
                  <select
                    value={draft.thinking}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        thinking: e.target.value as AppSettings["thinking"],
                      })
                    }
                  >
                    <option value="none">Off</option>
                    <option value="brief">Brief</option>
                    <option value="detailed">Detailed</option>
                  </select>
                </label>
              </div>
              <DiagnosticsPanel />
            </>
          ) : null}
        </section>
        <div className="settings-save-bar">
          {notice ? (
            <span role="status">{notice}</span>
          ) : (
            <span>Changes take effect when you save.</span>
          )}
          <button
            className="secondary-button"
            disabled={!!busy}
            onClick={() => {
              setDraft(p.settings);
              setNotice("Unsaved changes discarded.");
            }}
          >
            Discard changes
          </button>
          <button
            className="primary-button"
            disabled={!!busy}
            onClick={() => void save()}
          >
            {busy === "save" ? "Saving…" : "Save settings"}
            <Check size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Service({
  icon: Icon,
  title,
  detail,
  state,
  label,
}: {
  icon: typeof Bot;
  title: string;
  detail: string;
  state: "ready" | "waiting";
  label: string;
}) {
  return (
    <div className="service-card">
      <Icon size={21} />
      <strong>{title}</strong>
      <p>{detail}</p>
      <span className={`service-state ${state}`}>
        <span className="connection-dot" />
        {label}
      </span>
    </div>
  );
}
