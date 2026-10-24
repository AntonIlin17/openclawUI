# Stock data collection

The collector uses Yahoo Finance's public chart endpoint without an account or
API key. It is an unofficial, personal-research feed, with no guaranteed uptime,
coverage, or real-time entitlement. Structured provider data is used directly;
the AI model does not generate prices. Stooq's download endpoint returned HTTP
403 during implementation, so it is not used as a silent fallback.

Daily completed sessions for up to 30 US-listed USD stocks/ETFs are supported.
Choose 90 days, one year, or two years of requested history. Requests may return
less history for new listings or limited coverage. Current-session data is
excluded until one hour after the provider's regular close. Weekends and holidays
are not filled with invented rows. Long gaps and stale provider dates are flagged
for review; this is not an exchange-calendar completeness guarantee.

## Storage and provenance

The app's user-data `stock-data/` directory contains:

- `stocks.sqlite`: daily OHLCV, separate adjusted close, currency, exchange,
  collection timestamps, revision counts, settings, and run history.
- `raw/<run-id>/<symbol>.json.gz`: compressed original responses, including
  provider corporate-action fields when returned. Retention is configurable
  between 7, 30, and 90 days. Normalized prices are retained when raw files expire.

One `(symbol, market_date)` row is retained. Refreshing the requested window
updates provider revisions instead of duplicating observations, preserving the
first collection time and counting changes. Provider OHLC may already be split
adjusted; `adjusted_close` is the separately supplied dividend/split-adjusted
close. The dataset is not point-in-time history and has no delisted-universe
coverage guarantee.

SQLite writes use transactions and atomic file replacement. An unreadable database
is retained and reported; the app does not silently replace it with an empty one.
Interrupted runs are identified on reopening and scheduled tasks reconcile again.

## Scheduling

Automatic collection is opt-in. The default schedule is weekdays at 20:00 in
America/New_York, using the selected IANA time zone and daylight-saving offset.
The scheduler checks every 30 seconds while the app is open or in the tray, and
checks again on wake/startup. It reconciles one missed schedule slot by fetching
the requested history window, rather than replaying every missed job. The PC
does not collect while powered off. Holidays can yield no new daily rows.

Only one collection runs at a time. Each transient network request gets one
short retry; partial/failed scheduled runs retry after 15 minutes, up to three
attempts per slot. Previously saved data is retained on failure. Invalid tickers
appear in run history. A stopped run retains completed tickers. Database write
errors pause collection and surface an actionable error.

## Export

CSV export includes the entire saved history for the current watchlist or selected
ticker. A `.metadata.json` sidecar records provider, interval, adjustment policy,
export time, symbols, row count, and limitations. The local SQLite file remains
available for downstream analysis. Exports are explicit; no trades are placed.

## Validation

Unit tests cover provider validation, in-progress session filtering, adjusted
values, timezone/DST scheduling, duplicate prevention, revisions, persistence,
partial failures, overlap prevention, retry budgets, and interrupted-run recovery.
A live AAPL/SPY collection saved 500 daily rows during initial verification.
Synthetic fixtures and code are committed; personal databases and exports are not.

See [Yahoo historical-data field descriptions](https://finance.yahoo.com/quote/AAPL/history/)
and the [yfinance project's discussion of this unofficial data source](https://github.com/ranaroussi/yfinance).
