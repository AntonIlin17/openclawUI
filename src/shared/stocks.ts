export type StockSettings = {
  symbols: string[];
  enabled: boolean;
  time: string;
  timeZone: string;
  historyDays: number;
  rawRetentionDays: number;
  notifyFailures: boolean;
};
export type PriceBar = {
  symbol: string; date: string; open: number; high: number; low: number;
  close: number; adjustedClose: number | null; volume: number;
  currency: string; exchange: string; collectedAt: string;
};
export type StockRun = {
  id: string; startedAt: string; finishedAt?: string; trigger: string;
  status: "running" | "success" | "partial" | "failed" | "interrupted";
  symbols: string[]; completed: number; rows: number;
  errors: {symbol: string; message: string}[]; warnings: string[];
};
export type StockSummary = {
  symbol: string; count: number; firstDate: string; lastDate: string;
  close: number; previousClose: number | null; collectedAt: string;
};
export type StockState = {
  settings: StockSettings; summaries: StockSummary[]; runs: StockRun[];
  active: StockRun | null; nextRun: string | null; dataFolder: string;
  totalRows: number; storageError?: string;
};
export const DEFAULT_STOCK_SETTINGS: StockSettings = {
  symbols: [], enabled: false, time: "20:00", timeZone: "America/New_York",
  historyDays: 365, rawRetentionDays: 30, notifyFailures: true,
};
export function validateStockSettings(input: StockSettings): StockSettings {
  if (!input || !Array.isArray(input.symbols) || input.symbols.length > 30)
    throw new Error("Choose up to 30 US stock or ETF tickers.");
  const symbols = [...new Set(input.symbols.map(s => typeof s === "string" ? s.trim().toUpperCase() : ""))];
  if (symbols.some(s => !/^[A-Z][A-Z0-9]{0,9}(?:[.-][A-Z0-9]{1,3})?$/.test(s)))
    throw new Error("Use US ticker symbols such as AAPL, MSFT, SPY, or BRK-B.");
  if (typeof input.enabled !== "boolean" || typeof input.notifyFailures !== "boolean")
    throw new Error("Choose a collection and notification setting.");
  if (input.enabled && !symbols.length) throw new Error("Add a ticker before enabling automatic collection.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) throw new Error("Choose a valid daily collection time.");
  if (![90,365,730].includes(input.historyDays)) throw new Error("Choose 90 days, one year, or two years of history.");
  if (![7,30,90].includes(input.rawRetentionDays)) throw new Error("Choose a raw-response retention period.");
  if (typeof input.timeZone !== "string" || input.timeZone.length > 100) throw new Error("Choose a valid time zone.");
  try { new Intl.DateTimeFormat("en", {timeZone:input.timeZone}).format(); } catch { throw new Error("Choose a valid time zone."); }
  return {...input, symbols};
}
