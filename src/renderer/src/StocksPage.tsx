import React, { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  CalendarClock,
  Check,
  ChevronRight,
  Clock3,
  Database,
  FolderOpen,
  Layers3,
  LoaderCircle,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Square,
  TrendingUp,
  X,
} from "lucide-react";
import type { PriceBar, StockSettings, StockState } from "../../shared/stocks";
import { DEFAULT_STOCK_SETTINGS } from "../../shared/stocks";
import "./stocks.css";
const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
const stamp = (s?: string | null) =>
  s
    ? new Date(s).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";
const colors = [
  "#7865c4",
  "#278b89",
  "#e49665",
  "#779c60",
  "#c67399",
  "#5788bb",
];
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function StocksPage() {
  const [state, setState] = useState<StockState | null>(null),
    [draft, setDraft] = useState<StockSettings | null>(null);
  const [symbol, setSymbol] = useState(""),
    [bars, setBars] = useState<PriceBar[]>([]),
    [range, setRange] = useState(90),
    [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [exporting, setExporting] = useState(false);
  async function load() {
    try {
      const next = await window.openclaw.getStockState();
      setState(next);
      setDraft((current) => current ?? next.settings);
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  }
  useEffect(() => {
    void load();
    return window.openclaw.on<StockState>("stocks:changed", (next) => {
      setState(next);
      setDraft((current) => current ?? next.settings);
    });
  }, []);
  useEffect(() => {
    if (!state) return;
    setSymbol((current) =>
      state.settings.symbols.includes(current)
        ? current
        : (state.settings.symbols[0] ?? ""),
    );
  }, [state?.settings.symbols.join(",")]);
  useEffect(() => {
    let cancelled = false;
    setBars([]);
    if (symbol)
      void window.openclaw
        .getStockBars(symbol)
        .then((rows) => {
          if (!cancelled) setBars(rows);
        })
        .catch((e) => {
          if (!cancelled) setError(message(e));
        });
    return () => {
      cancelled = true;
    };
  }, [symbol, state?.summaries.find((s) => s.symbol === symbol)?.collectedAt]);
  async function save(next: StockSettings, description: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.openclaw.saveStockSettings(next);
      setState(result);
      setDraft((current) => ({
        ...(current ?? result.settings),
        symbols: result.settings.symbols,
        ...(!result.settings.symbols.length ? { enabled: false } : {}),
      }));
      setNotice(description);
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function add() {
    if (!state || !input.trim()) return;
    const added = input.split(/[\s,;]+/).filter(Boolean);
    if (
      await save(
        { ...state.settings, symbols: [...state.settings.symbols, ...added] },
        "Watchlist saved. Collect now or enable the daily schedule.",
      )
    )
      setInput("");
  }
  async function collect() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      setState(await window.openclaw.collectStocks());
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function exportData(onlySelected = false) {
    setExporting(true);
    setError(null);
    try {
      const result = await window.openclaw.exportStocks(
        onlySelected ? symbol : undefined,
      );
      if (result)
        setNotice(
          `Exported ${result.rows.toLocaleString()} rows to ${result.path}. A metadata file was saved alongside the CSV.`,
        );
    } catch (e) {
      setError(message(e));
    } finally {
      setExporting(false);
    }
  }
  const running = Boolean(state?.active),
    locked = busy || running;
  const settings = draft ?? DEFAULT_STOCK_SETTINGS;
  const latest = state?.runs.find((run) => run.status !== "running");
  const selected = state?.summaries.find((s) => s.symbol === symbol);
  const visible = bars.filter(
    (b) =>
      Date.parse(b.date) >=
      Date.parse(bars.at(-1)?.date ?? "1970-01-01") - range * 86400000,
  );
  const change =
    visible.length > 1
      ? (visible.at(-1)!.close / visible[0].close - 1) * 100
      : null;
  return (
    <div className="page-scroll">
      <div className="stock-page page-content">
        <div className="stock-heading">
          <div>
            <div className="page-eyebrow">
              <span className="tiny-line" /> MARKET WORKSPACE
            </div>
            <h1>
              Your market,
              <br />
              <span className="accent-text">in focus.</span>
            </h1>
            <p className="page-lead">
              A little more clarity. A daily record you can build on.
            </p>
          </div>
          <div className="stock-heading-actions">
            <span className="stock-source-badge">
              <ShieldCheck size={14} /> Daily data · saved locally
            </span>
            <div>
              <button
                className="secondary-button"
                disabled={!state?.totalRows || exporting}
                onClick={() => void exportData()}
              >
                <ArrowDownToLine size={16} />
                {exporting ? "Exporting…" : "Export CSV"}
              </button>
              <button
                className="primary-button"
                disabled={
                  locked ||
                  !state?.settings.symbols.length ||
                  Boolean(state?.storageError)
                }
                onClick={() => void collect()}
              >
                {running ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <RefreshCw size={16} />
                )}{" "}
                {running ? "Collecting…" : "Collect now"}
              </button>
            </div>
          </div>
        </div>
        {error ? (
          <div className="stock-alert error" role="alert">
            <span>{error}</span>
            <button className="text-button" onClick={() => void load()}>
              Refresh
            </button>
            <button
              className="icon-button"
              aria-label="Dismiss stock error"
              onClick={() => setError(null)}
            >
              <X size={15} />
            </button>
          </div>
        ) : null}
        {notice ? (
          <div className="stock-alert success" role="status">
            <Check size={16} />
            <span>{notice}</span>
            <button
              className="icon-button"
              aria-label="Dismiss stock notice"
              onClick={() => setNotice(null)}
            >
              <X size={15} />
            </button>
          </div>
        ) : null}
        {state?.storageError ? (
          <div role="alert" className="stock-alert error">
            {state.storageError}
          </div>
        ) : null}
        {!state && !error ? (
          <p className="stock-loading">
            <LoaderCircle className="spin" size={20} /> Opening your market
            workspace…
          </p>
        ) : null}
        <div className="stock-stats">
          <Metric
            icon={<Layers3 size={20} />}
            label="Your watchlist"
            value={String(state?.settings.symbols.length ?? 0)}
            detail="US stocks & ETFs"
            tone="lilac"
          />
          <Metric
            icon={<Database size={20} />}
            label="Saved observations"
            value={(state?.totalRows ?? 0).toLocaleString()}
            detail="Daily price records"
            tone="mint"
          />
          <Metric
            icon={<CalendarClock size={20} />}
            label="Next collection"
            value={
              state?.settings.enabled
                ? state.nextRun && Date.parse(state.nextRun) < Date.now()
                  ? "Catching up soon"
                  : stamp(state.nextRun)
                : "On your time"
            }
            detail={
              state?.settings.enabled
                ? `${state.settings.timeZone} · weekdays`
                : "Enable a schedule below"
            }
            tone="peach"
          />
          <Metric
            icon={<ShieldCheck size={20} />}
            label="Last collection"
            value={
              latest
                ? {
                    success: "Completed",
                    partial: "Needs a look",
                    failed: "Needs attention",
                    interrupted: "Stopped",
                    running: "Collecting",
                  }[latest.status]
                : "A fresh start"
            }
            detail={
              latest
                ? `${stamp(latest.finishedAt)} · ${latest.rows.toLocaleString()} rows checked`
                : "Choose a ticker to begin"
            }
            tone="blue"
          />
        </div>
        {running ? (
          <div className="collection-progress" role="status">
            <LoaderCircle size={18} className="spin" />
            <div>
              <strong>Collecting your daily history</strong>
              <span>
                {state!.active!.completed} of {state!.active!.symbols.length}{" "}
                tickers complete · {state!.active!.rows.toLocaleString()} rows
                checked
              </span>
              <progress
                max={state!.active!.symbols.length}
                value={state!.active!.completed}
              />
            </div>
            <button
              className="secondary-button"
              onClick={() =>
                void window.openclaw
                  .cancelStockCollection()
                  .catch((e) => setError(message(e)))
              }
            >
              <Square size={13} /> Stop
            </button>
          </div>
        ) : null}
        <div className="stock-main-grid">
          <section className="stock-panel price-panel">
            <div className="stock-panel-heading">
              <div>
                <div className="page-eyebrow">THE BIGGER PICTURE</div>
                <h2>Price history</h2>
              </div>
              <div className="chart-controls">
                <select
                  aria-label="Chart ticker"
                  value={symbol}
                  disabled={!state?.settings.symbols.length}
                  onChange={(e) => setSymbol(e.target.value)}
                >
                  {!symbol ? <option value="">Choose a ticker</option> : null}
                  {state?.settings.symbols.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <select
                  aria-label="Chart period"
                  value={range}
                  onChange={(e) => setRange(Number(e.target.value))}
                >
                  <option value={30}>1 month</option>
                  <option value={90}>3 months</option>
                  <option value={365}>1 year</option>
                  <option value={730}>2 years</option>
                </select>
              </div>
            </div>
            {visible.length ? (
              <>
                <div className="price-overview">
                  <span
                    className="ticker-medallion"
                    style={{
                      background:
                        colors[
                          Math.max(0, state!.settings.symbols.indexOf(symbol)) %
                            colors.length
                        ],
                    }}
                  >
                    {symbol.slice(0, 1)}
                  </span>
                  <div>
                    <span className="price-symbol">
                      {symbol} <small>USD · daily close</small>
                    </span>
                    <strong>{money(visible.at(-1)!.close)}</strong>
                  </div>
                  {change !== null ? (
                    <span
                      className={`price-change ${change >= 0 ? "positive" : "negative"}`}
                    >
                      <ArrowUpRight size={15} />
                      {change >= 0 ? "+" : ""}
                      {change.toFixed(2)}%<small>close-price change</small>
                    </span>
                  ) : null}
                </div>
                <PriceChart bars={visible} symbol={symbol} />
                <div className="chart-footer">
                  <span>
                    <i /> Saved history · {selected?.firstDate} →{" "}
                    {selected?.lastDate}
                  </span>
                  <button
                    className="text-button"
                    onClick={() => void exportData(true)}
                    disabled={exporting}
                  >
                    Export {symbol}
                    <ChevronRight size={13} />
                  </button>
                </div>
              </>
            ) : (
              <div className="chart-empty">
                <div className="empty-orbit">
                  <TrendingUp size={40} />
                  <span />
                  <span />
                </div>
                <h3>
                  {symbol
                    ? `Let’s get to know ${symbol}.`
                    : "Your next insight starts here."}
                </h3>
                <p>
                  Add a ticker and collect its history.
                  <br />
                  Your real price chart will appear here.
                </p>
                {!state?.settings.symbols.length ? (
                  <button
                    className="secondary-button"
                    onClick={() =>
                      document.getElementById("stock-tickers")?.focus()
                    }
                  >
                    <Plus size={15} /> Build your watchlist
                  </button>
                ) : null}
              </div>
            )}
          </section>
          <section className="stock-panel schedule-panel">
            <div className="stock-panel-heading">
              <span className="schedule-icon">
                <CalendarClock size={21} />
              </span>
              <div>
                <h2>Make it a daily thing.</h2>
                <p>Set it once. Come back to fresh data.</p>
              </div>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save(
                  { ...settings, symbols: state?.settings.symbols ?? [] },
                  settings.enabled
                    ? "Schedule saved. Collection runs in the tray and catches up within 30 seconds after reopening or waking."
                    : "Automatic collection paused. You can still collect manually.",
                );
              }}
            >
              <label className="stock-toggle">
                <span>
                  <strong>Automatic collection</strong>
                  <small>Monday through Friday</small>
                </span>
                <input
                  type="checkbox"
                  aria-label="Automatic stock collection"
                  checked={settings.enabled}
                  disabled={locked}
                  onChange={(e) =>
                    setDraft({ ...settings, enabled: e.target.checked })
                  }
                />
              </label>
              <div className="schedule-fields">
                <label>
                  At what time?
                  <input
                    aria-label="Collection time"
                    type="time"
                    value={settings.time}
                    disabled={locked}
                    onChange={(e) =>
                      setDraft({ ...settings, time: e.target.value })
                    }
                  />
                </label>
                <label>
                  Time zone
                  <select
                    aria-label="Collection time zone"
                    value={settings.timeZone}
                    disabled={locked}
                    onChange={(e) =>
                      setDraft({ ...settings, timeZone: e.target.value })
                    }
                  >
                    {[
                      ...new Set([
                        "America/New_York",
                        "America/Chicago",
                        "America/Denver",
                        "America/Los_Angeles",
                        "UTC",
                        settings.timeZone,
                      ]),
                    ].map((zone) => (
                      <option key={zone} value={zone}>
                        {zone.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  History to collect
                  <select
                    aria-label="Stock history window"
                    value={settings.historyDays}
                    disabled={locked}
                    onChange={(e) =>
                      setDraft({
                        ...settings,
                        historyDays: Number(e.target.value),
                      })
                    }
                  >
                    <option value={90}>90 days</option>
                    <option value={365}>1 year</option>
                    <option value={730}>2 years</option>
                  </select>
                </label>
              </div>
              <details className="stock-advanced">
                <summary>
                  <Settings2 size={13} /> Storage & notifications
                </summary>
                <label>
                  Keep original responses
                  <select
                    aria-label="Raw response retention"
                    value={settings.rawRetentionDays}
                    disabled={locked}
                    onChange={(e) =>
                      setDraft({
                        ...settings,
                        rawRetentionDays: Number(e.target.value),
                      })
                    }
                  >
                    {[7, 30, 90].map((days) => (
                      <option key={days} value={days}>
                        {days} days
                      </option>
                    ))}
                  </select>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={settings.notifyFailures}
                    disabled={locked}
                    onChange={(e) =>
                      setDraft({
                        ...settings,
                        notifyFailures: e.target.checked,
                      })
                    }
                  />{" "}
                  Notify me of scheduled failures
                </label>
              </details>
              <button
                type="submit"
                className="primary-button save-schedule"
                disabled={locked || !state}
              >
                <Check size={15} /> Save schedule
              </button>
            </form>
            <p className="schedule-footnote">
              <Clock3 size={13} /> Leave the app in the tray. Missed runs catch
              up when this PC wakes or the app reopens.
            </p>
          </section>
        </div>
        <div className="stock-bottom-grid">
          <section className="stock-panel watchlist-panel">
            <div className="stock-panel-heading">
              <div>
                <h2>A watchlist of your own</h2>
                <p>Choose the companies and funds you want to follow.</p>
              </div>
              <span className="soft-pill">
                {state?.settings.symbols.length ?? 0} / 30
              </span>
            </div>
            <form
              className="ticker-form"
              onSubmit={(e) => {
                e.preventDefault();
                void add();
              }}
            >
              <input
                id="stock-tickers"
                aria-label="Add stock tickers"
                placeholder="Add tickers, e.g. AAPL, MSFT, SPY"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={locked}
              />
              <button
                className="primary-button"
                disabled={locked || !input.trim() || !state}
              >
                <Plus size={15} /> Add
              </button>
            </form>
            {!state?.settings.symbols.length ? (
              <div className="watchlist-empty">
                <Layers3 size={25} />
                <strong>A space for your curiosity.</strong>
                <p>
                  Add US stock or ETF ticker symbols above.
                  <br />
                  Examples are identifiers, not recommendations.
                </p>
              </div>
            ) : (
              <div className="watchlist-table-wrap">
                <table className="watchlist-table">
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Latest close</th>
                      <th>Session</th>
                      <th>Records</th>
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.settings.symbols.map((s, i) => {
                      const summary = state.summaries.find(
                        (row) => row.symbol === s,
                      );
                      const stale =
                        summary &&
                        Date.now() - Date.parse(summary.lastDate) >
                          7 * 86400000;
                      return (
                        <tr
                          key={s}
                          className={symbol === s ? "selected-ticker" : ""}
                        >
                          <td>
                            <button
                              className="ticker-button"
                              onClick={() => setSymbol(s)}
                            >
                              <span
                                style={{
                                  background: colors[i % colors.length],
                                }}
                              >
                                {s.slice(0, 1)}
                              </span>
                              {s}
                            </button>
                          </td>
                          <td>
                            {summary ? (
                              money(summary.close)
                            ) : (
                              <span className="muted">Not collected</span>
                            )}
                          </td>
                          <td>
                            {summary ? (
                              <span className={stale ? "stale-date" : ""}>
                                {summary.lastDate}
                                {stale ? " · stale" : ""}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>{summary?.count.toLocaleString() ?? "—"}</td>
                          <td>
                            <button
                              className="icon-button"
                              aria-label={`Remove ${s} from watchlist`}
                              disabled={locked}
                              onClick={() =>
                                void save(
                                  {
                                    ...state.settings,
                                    symbols: state.settings.symbols.filter(
                                      (item) => item !== s,
                                    ),
                                    enabled:
                                      state.settings.symbols.length === 1
                                        ? false
                                        : state.settings.enabled,
                                  },
                                  `${s} removed from the watchlist. Its saved history is retained locally.`,
                                )
                              }
                            >
                              <X size={13} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="stock-panel runs-panel">
            <div className="stock-panel-heading">
              <div>
                <h2>Behind the scenes</h2>
                <p>A record of what happened, every time.</p>
              </div>
              <span className="activity-orb" />
            </div>
            {!state?.runs.length ? (
              <div className="runs-empty">
                <Clock3 size={27} />
                <strong>Your collection story starts here.</strong>
                <p>Runs, saved records, and issues will appear here.</p>
              </div>
            ) : (
              <div className="stock-run-list">
                {state.runs.slice(0, 10).map((run) => (
                  <details key={run.id} className={`stock-run ${run.status}`}>
                    <summary>
                      <span className="run-status-dot" />
                      <span>
                        <strong>
                          {run.status === "success"
                            ? "Collection complete"
                            : run.status === "partial"
                              ? "Partially collected"
                              : run.status === "running"
                                ? "Collection in progress"
                                : run.status === "interrupted"
                                  ? "Collection stopped"
                                  : "Collection needs attention"}
                        </strong>
                        <small>
                          {stamp(run.startedAt)} · {run.trigger}
                        </small>
                      </span>
                      <span className="run-row-count">
                        {run.rows.toLocaleString()}
                        <small>rows checked</small>
                      </span>
                      <ChevronRight size={13} />
                    </summary>
                    <div className="run-detail">
                      <p>
                        {run.completed} / {run.symbols.length} tickers checked.
                        Repeated observations update existing records.
                      </p>
                      {run.errors.map((issue, i) => (
                        <p className="run-error" key={i}>
                          <strong>{issue.symbol}:</strong> {issue.message}
                        </p>
                      ))}
                      {run.warnings.map((warning, i) => (
                        <p className="run-warning" key={i}>
                          {warning}
                        </p>
                      ))}
                      {!run.errors.length && !run.warnings.length ? (
                        <p>
                          Valid completed daily sessions were saved
                          successfully.
                        </p>
                      ) : null}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </section>
        </div>
        <footer className="stock-data-footer">
          <span>
            <Database size={16} />
            <strong>Your data stays with you.</strong> Local SQLite storage ·
            CSV + metadata export
          </span>
          <button
            className="text-button"
            disabled={!state}
            onClick={() =>
              void window.openclaw
                .openStockFolder()
                .catch((e) => setError(message(e)))
            }
          >
            <FolderOpen size={15} /> Open data folder <ArrowUpRight size={13} />
          </button>
        </footer>
        <p className="stock-source-note">
          Source: Yahoo Finance · unofficial public daily feed for personal
          research. Availability and adjustments can change. Prices are not
          real-time. Completed sessions only; weekends and holidays are not
          filled. This workspace collects data and does not place trades.
        </p>
      </div>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: string;
}) {
  return (
    <div className={`stock-metric ${tone}`}>
      <div>
        <span>{label}</span>
        <span className="metric-icon">{icon}</span>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function PriceChart({ bars, symbol }: { bars: PriceBar[]; symbol: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 800,
    h = 245,
    left = 58,
    right = 20,
    top = 18,
    bottom = 32;
  const values = bars.map((b) => b.close),
    min = Math.min(...values),
    max = Math.max(...values),
    padding = Math.max((max - min) * 0.15, max * 0.005),
    low = min - padding,
    high = max + padding;
  const first = Date.parse(bars[0].date),
    last = Date.parse(bars.at(-1)!.date);
  const x = (b: PriceBar) =>
      left +
      ((Date.parse(b.date) - first) / Math.max(1, last - first)) *
        (w - left - right),
    y = (v: number) => top + ((high - v) / (high - low)) * (h - top - bottom);
  const line = bars
    .map((b, i) => `${i ? "L" : "M"}${x(b)},${y(b.close)}`)
    .join(" ");
  const point = bars[Math.min(hover ?? bars.length - 1, bars.length - 1)];
  return (
    <div className="price-chart">
      <div className="chart-inspection" aria-live="polite">
        <span>{point.date}</span>
        <strong>{money(point.close)}</strong>
        <small>Volume {point.volume.toLocaleString()}</small>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`${symbol} daily closing prices, ${bars[0].date} to ${bars.at(-1)!.date}, low ${money(min)}, high ${money(max)}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const chartX = ((event.clientX - rect.left) / rect.width) * w;
          let closest = 0;
          for (let i = 1; i < bars.length; i++)
            if (
              Math.abs(x(bars[i]) - chartX) <
              Math.abs(x(bars[closest]) - chartX)
            )
              closest = i;
          setHover(closest);
        }}
      >
        <defs>
          <linearGradient id="price-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#9280d6" stopOpacity=".27" />
            <stop offset="100%" stopColor="#9280d6" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((i) => {
          const value = low + ((high - low) * i) / 4;
          return (
            <g key={i}>
              <line
                x1={left}
                x2={w - right}
                y1={y(value)}
                y2={y(value)}
                stroke="#eeedf3"
                strokeDasharray="3 5"
              />
              <text x={left - 10} y={y(value) + 4} textAnchor="end">
                {value.toFixed(0)}
              </text>
            </g>
          );
        })}
        <path
          d={`${line} L${x(bars.at(-1)!)},${h - bottom} L${x(bars[0])},${h - bottom} Z`}
          fill="url(#price-area)"
        />
        <path
          d={line}
          fill="none"
          stroke="#8170bd"
          strokeWidth="2.8"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {hover !== null ? (
          <line
            x1={x(point)}
            x2={x(point)}
            y1={top}
            y2={h - bottom}
            stroke="#b9addb"
            strokeDasharray="4 4"
          />
        ) : null}
        <circle
          cx={x(point)}
          cy={y(point.close)}
          r="5"
          fill="#8170bd"
          stroke="white"
          strokeWidth="2.5"
        />
        {[0, Math.floor((bars.length - 1) / 2), bars.length - 1]
          .filter((v, i, a) => a.indexOf(v) === i)
          .map((i) => (
            <text
              key={i}
              x={x(bars[i])}
              y={h - 5}
              textAnchor={
                i === 0 ? "start" : i === bars.length - 1 ? "end" : "middle"
              }
            >
              {new Date(bars[i].date + "T12:00:00Z").toLocaleDateString(
                undefined,
                { month: "short", day: "numeric", timeZone: "UTC" },
              )}
            </text>
          ))}
      </svg>
      <input
        className="chart-point-slider"
        type="range"
        aria-label="Inspect historical price"
        min={0}
        max={bars.length - 1}
        value={hover ?? bars.length - 1}
        onChange={(e) => setHover(Number(e.target.value))}
      />
    </div>
  );
}
