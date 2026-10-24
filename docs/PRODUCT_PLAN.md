# OpenClaw Desktop product plan

Status: desktop redesign delivered on the development branch; stock collection implementation pending.
Updated October 22, 2026.

This document separates the agreed product direction from proposed implementation.
Planned features below are not claims about the current app.

## Product purpose

A Windows desktop assistant that makes OpenClaw useful without requiring terminal
work during normal use. It helps people run recurring tasks, collect online data,
research questions, and find and organize files on their computer.

The initial setup may assume OpenClaw and Ollama are already installed. Detecting
them, explaining connection failures, and connecting reliably must be simple.

## Confirmed requirements

- Serve Windows users who want to use OpenClaw without terminal setup or commands.
- Use local AI models only, with no per-use cloud model API costs.
- Prioritize scheduled stock-data collection, local storage, and export first.
- Target US stocks and ETFs with an editable watchlist in the first release.
- Prefer data sources that do not require an account. Do not require an API-key
  signup as the default experience without revisiting that preference.
- Run scheduled collection while the app is in the tray; catch up after sleep or
  reopening. The first release does not require an always-on remote machine or a
  separately installed background task.
- Keep trading execution outside the first release: collect data for a future
  analysis or trading system, without placing orders.
- Support online research and searching for information on the web.
- Support searching chosen folders and searching across the PC. Preview file
  moves and renames before applying them.
- Consider codebase assistance later, after the main workflows work well.
- Use a clean, calm interface with polished typography, visible progress, task
  cards, file previews, and research results.
- Improve real functionality before rewriting the GitHub introduction. Then show
  real screenshots of completed workflows and explain exactly what the app does.
- Commit and push each coherent set of project changes to GitHub, with descriptive
  commit messages and validation results.

## Proposed first workflow: scheduled stock-data collection

The overall scope is agreed. The following technical choices and editable defaults
are recommendations to validate during implementation.

1. Let the user choose a watchlist, source, schedule, and local output folder.
2. Fetch daily open, high, low, close, and volume from a structured data source.
   Use a replaceable provider adapter; do not ask an AI model to invent or extract
   numerical prices when a structured API is available.
3. Store records locally in SQLite and provide CSV exports. Keep provider, feed,
   symbol, currency, market time, collection time, and adjustment information so
   downstream analysis can interpret each dataset correctly.
4. Preserve raw provider responses separately from normalized records. Treat
   corporate actions, data revisions, and adjustment policies explicitly.
5. Validate records; detect gaps and duplicates; retry transient failures within
   provider limits; retain a run history with counts and actionable errors.
6. Show the next run, current stage, progress, last successful collection, output
   location, and a preview of the saved data. Clearly identify stale data and
   partial runs.
7. Keep provider credentials on the user's machine, out of Git and logs. Publish
   code and synthetic fixtures, not personal datasets or provider credentials.
8. Keep tasks running in the tray. On wake or restart, reconcile the last successful
   market date with the intended schedule and backfill missing sessions. Prevent
   concurrent and duplicate runs; report what was recovered. A powered-off PC does
   not collect until it runs again.

Proposed editable defaults: a small example watchlist, one year of daily history,
one evening refresh at 8 p.m. America/New_York, an app-managed local data folder,
and notifications for failure or required attention. Use timezone-aware dates and
provider data availability, rather than assuming every weekday is a trading day.
Do not present the example watchlist as investment recommendations.

Daily collection is a proposed starting point, not a claim that daily data is
sufficient for every future trading strategy. Intraday data, news, fundamentals,
and analysis can be added after the collection pipeline is reliable.

### Provider research

Checked against provider documentation on October 22, 2026. Plans and entitlements
must be rechecked before implementation and when configuring a provider.

- [Massive stock-data plans](https://www.massive.com/stocks): its Basic tier lists
  end-of-day data, two years of history, and five API calls per minute at no monthly
  cost. This is a candidate for a small initial US watchlist if a free account is
  acceptable. Dataset access and permitted use must match the selected plan.
- [Alpha Vantage support](https://www.alphavantage.co/support/): its standard free
  service lists 25 requests per day. This limit affects watchlist size and retries.
- [Alpaca market-data documentation](https://docs.alpaca.markets/us/docs/about-market-data-api)
  and [FAQ](https://docs.alpaca.markets/us/docs/market-data-faq): distinguish IEX
  from consolidated SIP coverage and account entitlements. Never silently treat a
  single-exchange feed as consolidated market data.
- [yahoo-finance2](https://github.com/gadicc/yahoo-finance2) and
  [yfinance](https://ranaroussi.github.io/yfinance/): candidates to evaluate for the
  preferred no-account workflow. Both are unofficial Yahoo clients. The yfinance
  documentation describes its research/educational purpose and Yahoo's personal-use
  terms. A candidate must pass an actual collection and failure-recovery check;
  do not imply a guaranteed official feed. Keep source availability and data-use
  terms distinct from the open-source app's license. Check runtime compatibility
  before choosing a library: the current yahoo-finance2 documentation lists Node
  22+ support, which may require an Electron/runtime update.

The initial no-account preference takes priority over the earlier API-key provider
suggestion. Provider choice is not settled by the research list above. CSV import
can provide a useful fallback without silently substituting or fabricating data.

No provider account, subscription, API key, or collection schedule has been created.

## Delivery stages

1. **Reliable foundation:** reproduce startup and connection problems; keep
   settings accessible; show clear service readiness and recovery actions; verify
   the installed gateway protocol and local model capabilities.
2. **One complete collection task:** configure, run, validate, save, preview, and
   export a stock dataset manually before adding scheduling.
3. **Reliable scheduling:** persist tasks and run history; handle sleep, restarts,
   missed runs, retries, and duplicate prevention according to the chosen execution
   model; show progress and useful notifications.
4. **Usable workspace:** build the calm task-oriented interface around actual run
   states and outputs; extend it to research and file workflows.
5. **Public presentation:** rewrite the README around verified features, add real
   screenshots with non-sensitive example data, explain setup and limitations,
   and provide reproducible build and release instructions.

## Initial baseline and observed issues (before the redesign)

- The repository contains an Electron/React/TypeScript Windows client using a
  direct WebSocket connection to an OpenClaw Gateway in WSL Ubuntu.
- The current UI centers on chat, sessions, attachments, gateway controls, and
  diagnostics. It does not yet provide the proposed collection workspace.
- No automated tests, GitHub Actions workflows, or license file were found in the
  initial checkout. License choice remains an owner decision.
- The existing README is mostly technical setup documentation and has no usage
  screenshots.
- TypeScript checking and the production build passed on this machine. Vite warns
  about large bundles; dependencies also emit deprecation warnings during install.
- The local Electron runtime required repair before the development app launched.
  This was a local dependency repair, not a source change.
- Settings exceeded the window height, hiding its bottom controls. The first fix
  bounds the dialog, enables scrolling, keeps header/actions visible, and sizes
  checkboxes consistently. Post-change visual verification is still pending.
- Ollama and the development app were launched. The installed gateway and local
  model server both responded to health checks after keeping the WSL distro alive.
  The app remained disconnected: the saved gateway address used the WSL VM IP,
  while a Windows localhost health request succeeded. Root cause and a durable
  startup/connection fix still need investigation.
- A draft settings edit changed the gateway address to localhost, but it was not
  saved. Do not assume the app is connected or that chat has been verified.
- Desktop verification was interrupted by the app being minimized and the desktop
  control reporting user interaction. Build success is not end-to-end validation.

Keep machine-specific settings, model files, personal folder paths, credentials,
and diagnostic logs out of commits.

## Remaining implementation decisions

- Validate the no-account provider, runtime compatibility, adjustment behavior,
  failure handling, and actual historical coverage before committing to it.
- Implement editable defaults for watchlist, history range, output location,
  retention, and notifications. The owner delegated unspecified stock-data
  implementation choices; these do not require another broad discovery round.
- What research results should contain, which file types to prioritize, and the
  exact file operations supported in the next stage.
- Which local model best handles task configuration and tool use on the available
  hardware; evaluate it against concrete tasks before changing the configured model.
- Public project name and license, after the working product direction is settled.

## Verification and Git workflow

Use focused commits on a development branch and push each completed change set.
Record what was tested and what remains unverified; do not present a successful
build as proof that gateway connections, collection, or scheduling work.

For each functional stage, verify a real workflow and its failure cases before
moving on. Capture documentation screenshots only after the corresponding workflow
works, using synthetic or non-sensitive example data. Never publish tokens or logs
that may contain configuration secrets.

## Desktop redesign milestone — October 22, 2026

Implemented on `codex/usability-and-product-direction`, tracked in pull request #2:

- A new light workspace with overview, conversations, files/folders, and connection
  settings; real service state replaces the unexplained reconnecting screen.
- Explicit setup instructions explain that Ollama stays running and users work in
  this desktop app rather than launching another OpenClaw interface from Ollama.
- Conversation drafts survive navigation, failed sends keep their text, offline
  sends are disabled, and tool results/reasoning are distinguished from answers.
- Settings are split into connection, folder, and advanced sections. Save/discard
  remain reachable at the minimum supported window size.
- Loopback-bound gateways use localhost; unhealthy WSL IP fallbacks are avoided.
  Socket replacement cannot let an old close event disconnect a new connection.
  A WSL keep-alive follows the app lifetime when starting the local gateway.
- Six gateway/history tests and six production-renderer UI tests pass. TypeScript,
  main compilation, and renderer production build pass; Vite bundle-size warnings
  remain. Live connection and a real local-model request/response were verified.
- Real screenshots and a plain-language start guide are included in the README.

Stock collection, scheduling, dedicated PC-wide search, richer result previews,
model benchmarking, installer distribution, and release publication remain future
work. A redesigned interface does not imply these features are implemented.

## Local model milestone — October 23, 2026

- Added installed-model selection in settings and conversations, with context
  size and optional extended reasoning. Cloud aliases are excluded and models
  without tool support are disabled.
- Model changes preserve unrelated configuration, create a private backup,
  reconnect the gateway, and update the selected conversation when requested.
- Fixed duplicate labels preventing creation of additional conversations.
- Qwen3.5 9B passed structured-output and tool-call smoke checks, plus live
  file access, web search, and switching to/from Qwen3.6 27B. The smaller model
  was substantially faster on the tested 16 GB GPU. These checks are not a
  general model-quality benchmark.
- Twelve gateway/history/model tests and nine renderer UI tests pass. TypeScript
  and production builds pass, with the existing Vite bundle-size warning.

Scheduled stock collection and the other unfinished workflows above remain
future work.

## Installed Windows build — October 23, 2026

- Version 0.2.0 packages the redesign as an NSIS installer. A local Windows
  installation was updated and verified with a real model response.
- Installed builds synchronize the named OpenClaw Desktop startup entry with
  their executable and saved preference. Development launches do not replace
  the installed startup command.
- Desktop/Start menu shortcuts and a stale development startup entry were
  repaired on the test PC, with the previous app/settings backed up privately.
- The README now distinguishes the installed app, development Electron runs,
  Ollama's integration tiles, and model selection.

The installer was built and installed locally. A public GitHub release has not
been published.
