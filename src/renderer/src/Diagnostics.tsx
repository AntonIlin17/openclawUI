import React, { useEffect, useMemo, useRef, useState } from "react";
import type { LogEntry } from "../../shared/ipc";
export function DiagnosticsPanel() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [follow, setFollow] = useState(true);
  const [running, setRunning] = useState(false);
  const [logPath, setLogPath] = useState<{
    file: string;
    folder: string;
  } | null>(null);
  const [updateInfo, setUpdateInfo] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void window.openclaw.tailLogs(400).then(setEntries);
    void window.openclaw.getLogsPath().then(setLogPath);
    const off = window.openclaw.on<LogEntry>("logs:entry", (entry) => {
      setEntries((prev) => {
        const next = [...prev, entry];
        return next.length > 800 ? next.slice(next.length - 800) : next;
      });
    });
    return off;
  }, []);

  useEffect(() => {
    if (!follow) {
      return;
    }
    const node = containerRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [entries, follow]);

  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) {
      return entries;
    }
    return entries.filter((entry) =>
      `${entry.level} ${entry.scope} ${entry.message} ${entry.data ? JSON.stringify(entry.data) : ""}`
        .toLowerCase()
        .includes(term),
    );
  }, [entries, filter]);

  async function runDiagnostics() {
    setRunning(true);
    try {
      const result = await window.openclaw.runDiagnostics();
      setEntries(result);
    } finally {
      setRunning(false);
    }
  }

  async function checkUpdates() {
    setUpdateInfo("Checking…");
    try {
      const result = await window.openclaw.checkForUpdates();
      if (!result.ok) {
        setUpdateInfo(
          `Cannot check: ${result.reason ?? "unknown"} (current ${result.current ?? "?"})`,
        );
        return;
      }
      if (result.version && result.version !== result.current) {
        setUpdateInfo(
          `Update ${result.version} available — downloading. You'll be prompted to restart.`,
        );
      } else {
        setUpdateInfo(`Up to date (${result.current}).`);
      }
    } catch (error) {
      setUpdateInfo(
        `Check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return (
    <div className="diagnostics-panel">
      <div className="diagnostics-header">
        <strong>Diagnostics &amp; logs</strong>
        <div className="diagnostics-actions">
          <button onClick={() => void runDiagnostics()} disabled={running}>
            {running ? "Running…" : "Run gateway diagnostics"}
          </button>
          <button onClick={() => void window.openclaw.openLogFile()}>
            Open log file
          </button>
          <button onClick={() => void window.openclaw.openLogsFolder()}>
            Open folder
          </button>
          <button onClick={() => void checkUpdates()}>Check for updates</button>
        </div>
      </div>
      {logPath ? (
        <p className="settings-hint">
          Log file: <code>{logPath.file}</code>
        </p>
      ) : null}
      {updateInfo ? <p className="settings-hint">{updateInfo}</p> : null}
      <div className="diagnostics-toolbar">
        <input
          className="diagnostics-filter"
          placeholder="Filter (scope, message…)"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <label className="toggle">
          <input
            type="checkbox"
            checked={follow}
            onChange={(event) => setFollow(event.target.checked)}
          />
          Follow new entries
        </label>
      </div>
      <div className="diagnostics-log" ref={containerRef}>
        {filtered.length === 0 ? (
          <p className="settings-hint">No log entries yet.</p>
        ) : (
          filtered.map((entry, index) => (
            <div
              className={`log-row level-${entry.level}`}
              key={`${entry.ts}-${index}`}
            >
              <span className="log-ts">{entry.ts.slice(11, 19)}</span>
              <span className={`log-level lvl-${entry.level}`}>
                {entry.level}
              </span>
              <span className="log-scope">{entry.scope}</span>
              <span className="log-message">{entry.message}</span>
              {entry.data ? (
                <pre className="log-data">
                  {JSON.stringify(entry.data, null, 0)}
                </pre>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
