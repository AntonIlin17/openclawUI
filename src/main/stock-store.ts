import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import initSqlJs, { type Database } from "sql.js";
import type {
  PriceBar,
  StockRun,
  StockSettings,
  StockSummary,
} from "../shared/stocks.js";
import {
  DEFAULT_STOCK_SETTINGS,
  validateStockSettings,
} from "../shared/stocks.js";
const require = createRequire(import.meta.url);
export type ScheduleCursor = {
  slot: string | null;
  retryAt: string | null;
  attempts: number;
};
export class StockStore {
  private constructor(
    readonly folder: string,
    private db: Database,
  ) {}
  static async open(folder: string): Promise<StockStore> {
    fs.mkdirSync(folder, { recursive: true });
    const SQL = await initSqlJs({
      locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
    });
    const file = path.join(folder, "stocks.sqlite");
    const db = fs.existsSync(file)
      ? new SQL.Database(fs.readFileSync(file))
      : new SQL.Database();
    db.run(`CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS prices(symbol TEXT NOT NULL,market_date TEXT NOT NULL,open REAL NOT NULL,high REAL NOT NULL,low REAL NOT NULL,close REAL NOT NULL,adjusted_close REAL,volume INTEGER NOT NULL,currency TEXT NOT NULL,exchange TEXT NOT NULL,collected_at TEXT NOT NULL,first_collected_at TEXT NOT NULL,revisions INTEGER NOT NULL DEFAULT 0,provider TEXT NOT NULL DEFAULT 'yahoo',feed TEXT NOT NULL DEFAULT 'chart-daily',PRIMARY KEY(symbol,market_date));
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,started_at TEXT NOT NULL,payload TEXT NOT NULL);`);
    const store = new StockStore(folder, db);
    let interrupted = false;
    for (const run of store.runs())
      if (run.status === "running") {
        run.status = "interrupted";
        run.finishedAt = new Date().toISOString();
        run.errors.push({
          symbol: "Collection",
          message:
            "The app closed before this run finished. Saved prices were retained.",
        });
        store.saveRun(run, false);
        interrupted = true;
      }
    if (interrupted)
      store.setMeta(
        "cursor",
        { slot: null, retryAt: null, attempts: 0 },
        false,
      );
    store.persist();
    return store;
  }
  private rows(
    sql: string,
    params: (string | number)[] = [],
  ): Record<string, any>[] {
    const statement = this.db.prepare(sql);
    try {
      statement.bind(params);
      const rows: Record<string, any>[] = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  }
  getMeta<T>(key: string, fallback: T): T {
    const row = this.rows("SELECT value FROM metadata WHERE key=?", [key])[0];
    return row ? JSON.parse(row.value) : fallback;
  }
  setMeta(key: string, value: unknown, persist = true): void {
    this.db.run("INSERT OR REPLACE INTO metadata VALUES (?,?)", [
      key,
      JSON.stringify(value),
    ]);
    if (persist) this.persist();
  }
  settings(): StockSettings {
    return validateStockSettings(
      this.getMeta("settings", DEFAULT_STOCK_SETTINGS),
    );
  }
  saveSettings(settings: StockSettings): void {
    this.setMeta("settings", validateStockSettings(settings));
  }
  cursor(): ScheduleCursor {
    return this.getMeta("cursor", { slot: null, retryAt: null, attempts: 0 });
  }
  runs(): StockRun[] {
    return this.rows(
      "SELECT payload FROM runs ORDER BY started_at DESC LIMIT 100",
    ).map((row) => JSON.parse(row.payload));
  }
  saveRun(run: StockRun, persist = true): void {
    this.db.run("INSERT OR REPLACE INTO runs VALUES (?,?,?)", [
      run.id,
      run.startedAt,
      JSON.stringify(run),
    ]);
    if (persist) this.persist();
  }
  saveBars(bars: PriceBar[]): void {
    this.db.run("BEGIN");
    try {
      for (const b of bars)
        this.db.run(
          `INSERT INTO prices(symbol,market_date,open,high,low,close,adjusted_close,volume,currency,exchange,collected_at,first_collected_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(symbol,market_date) DO UPDATE SET
        revisions=prices.revisions + CASE WHEN prices.open<>excluded.open OR prices.high<>excluded.high OR prices.low<>excluded.low OR prices.close<>excluded.close OR prices.adjusted_close IS NOT excluded.adjusted_close OR prices.volume<>excluded.volume THEN 1 ELSE 0 END,
        open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,adjusted_close=excluded.adjusted_close,volume=excluded.volume,currency=excluded.currency,exchange=excluded.exchange,collected_at=excluded.collected_at`,
          [
            b.symbol,
            b.date,
            b.open,
            b.high,
            b.low,
            b.close,
            b.adjustedClose,
            b.volume,
            b.currency,
            b.exchange,
            b.collectedAt,
            b.collectedAt,
          ],
        );
      this.db.run("COMMIT");
      this.persist();
    } catch (error) {
      try {
        this.db.run("ROLLBACK");
      } catch {}
      throw error;
    }
  }
  bars(symbol: string): PriceBar[] {
    return this.rows(
      `SELECT symbol,market_date AS date,open,high,low,close,adjusted_close AS adjustedClose,volume,currency,exchange,collected_at AS collectedAt FROM prices WHERE symbol=? ORDER BY market_date`,
      [symbol],
    ) as PriceBar[];
  }
  summaries(symbols: string[]): StockSummary[] {
    return symbols.flatMap((symbol) => {
      const bars = this.bars(symbol);
      const last = bars.at(-1);
      return last
        ? [
            {
              symbol,
              count: bars.length,
              firstDate: bars[0].date,
              lastDate: last.date,
              close: last.close,
              previousClose: bars.at(-2)?.close ?? null,
              collectedAt: last.collectedAt,
            },
          ]
        : [];
    });
  }
  exportRows(symbols: string[]): Record<string, any>[] {
    return symbols.flatMap((symbol) =>
      this.rows(
        "SELECT provider,feed,symbol,currency,exchange,market_date,open,high,low,close,adjusted_close,volume,first_collected_at,collected_at,revisions FROM prices WHERE symbol=? ORDER BY market_date",
        [symbol],
      ),
    );
  }
  persist(): void {
    const file = path.join(this.folder, "stocks.sqlite"),
      temporary = file + ".tmp";
    fs.writeFileSync(temporary, Buffer.from(this.db.export()));
    fs.renameSync(temporary, file);
  }
  close(): void {
    this.db.close();
  }
}

export const STOCK_CSV_COLUMNS = [
  "provider",
  "feed",
  "symbol",
  "currency",
  "exchange",
  "market_date",
  "open",
  "high",
  "low",
  "close",
  "adjusted_close",
  "volume",
  "first_collected_at",
  "collected_at",
  "revisions",
];
export function stockCsv(rows: Record<string, any>[]): string {
  const escape = (value: unknown) => {
    let text = value == null ? "" : String(value);
    if (typeof value === "string" && /^[\s]*[=+@-]/.test(text))
      text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return (
    STOCK_CSV_COLUMNS.join(",") +
    "\r\n" +
    rows
      .map((row) =>
        STOCK_CSV_COLUMNS.map((column) => escape(row[column])).join(","),
      )
      .join("\r\n") +
    "\r\n"
  );
}
