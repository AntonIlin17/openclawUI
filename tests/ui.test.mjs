import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

// Exercise the production renderer with an isolated IPC fixture. No installed
// OpenClaw configuration, personal files, or real model calls are used here.
let browser, server, baseURL;
const root = path.resolve("dist/renderer");
before(async () => {
  server = createServer(async (req, res) => {
    try {
      const file = path.resolve(
        root,
        "." +
          (new URL(req.url, "http://localhost").pathname === "/"
            ? "/index.html"
            : decodeURIComponent(
                new URL(req.url, "http://localhost").pathname,
              )),
      );
      if (!file.startsWith(root + path.sep)) {
        res.writeHead(403).end();
        return;
      }
      const content = await readFile(file);
      const type =
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".woff": "font/woff",
          ".woff2": "font/woff2",
        }[path.extname(file)] ?? "application/octet-stream";
      res.writeHead(200, { "Content-Type": type });
      res.end(content);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
    headless: true,
  });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function renderer(viewport = { width: 1180, height: 780 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) =>
    console.error("RENDERER_ERROR", error.message),
  );
  await page.addInitScript(() => {
    const events = {};
    const settings = {
      gatewayUrl: "ws://127.0.0.1:18789",
      host: "127.0.0.1",
      port: 18789,
      wslDistro: "Ubuntu",
      gatewayCommand: "openclaw gateway start",
      modelStartCommand: "",
      autoStartGateway: true,
      authMode: "auto",
      autostart: false,
      fileAccessPaths: [],
      prefetchFileListings: true,
      thinking: "brief",
    };
    window.__uiTest = {
      emit: (name, payload) =>
        (events[name] || []).forEach((fn) => fn(payload)),
      failSend: false,
      saves: 0,
      modelSelection: null,
      modelFailure: false,
      stockSaveFailure: false,
      stockExports: [],
    };
    const localModels = {
      defaultModel: "ollama/qwen3.5:9b",
      contextWindow: 32768,
      thinking: false,
      models: [
        {
          name: "qwen3.5:9b",
          sizeBytes: 6600000000,
          parameterSize: "9B",
          quantization: "Q4_K_M",
          tools: true,
          reasoning: true,
          vision: true,
        },
        {
          name: "qwen3.6:27b",
          sizeBytes: 17000000000,
          parameterSize: "27B",
          quantization: "Q4_K_M",
          tools: true,
          reasoning: true,
          vision: true,
        },
      ],
    };
    const stockState = {
      settings: {
        symbols: [],
        enabled: false,
        time: "20:00",
        timeZone: "America/New_York",
        historyDays: 365,
        rawRetentionDays: 30,
        notifyFailures: true,
      },
      summaries: [],
      runs: [],
      active: null,
      nextRun: null,
      dataFolder: "C:/fixture/stock-data",
      totalRows: 0,
    };
    window.__uiTest.stocks = stockState;
    window.openclaw = {
      getStockState: async () => structuredClone(stockState),
      saveStockSettings: async (input) => {
        if (window.__uiTest.stockSaveFailure)
          throw Error("Fixture stock save failed");
        if (input.enabled && !input.symbols.length)
          throw Error("Add a ticker before enabling automatic collection.");
        const symbols = [
          ...new Set(input.symbols.map((s) => s.trim().toUpperCase())),
        ];
        if (symbols.some((s) => !/^[A-Z][A-Z0-9.-]{0,13}$/.test(s)))
          throw Error("Use US ticker symbols.");
        stockState.settings = { ...input, symbols };
        stockState.nextRun = input.enabled ? "2026-10-24T00:00:00Z" : null;
        window.__uiTest.emit("stocks:changed", structuredClone(stockState));
        return structuredClone(stockState);
      },
      collectStocks: async () => {
        stockState.summaries = stockState.settings.symbols.map((symbol) => ({
          symbol,
          count: 2,
          firstDate: "2026-10-21",
          lastDate: "2026-10-22",
          close: 103,
          previousClose: 102,
          collectedAt: new Date().toISOString(),
        }));
        stockState.totalRows = stockState.summaries.length * 2;
        stockState.runs = [
          {
            id: "fixture-stock-run",
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            status: "success",
            trigger: "manual",
            symbols: stockState.settings.symbols,
            rows: stockState.totalRows,
            completed: stockState.settings.symbols.length,
            errors: [],
            warnings: [],
          },
        ];
        window.__uiTest.emit("stocks:changed", structuredClone(stockState));
        return structuredClone(stockState);
      },
      getStockBars: async (symbol) =>
        stockState.totalRows
          ? [
              {
                symbol,
                date: "2026-10-21",
                open: 100,
                high: 103,
                low: 99,
                close: 102,
                adjustedClose: 101,
                volume: 1000,
                currency: "USD",
                exchange: "TEST",
                collectedAt: new Date().toISOString(),
              },
              {
                symbol,
                date: "2026-10-22",
                open: 101,
                high: 104,
                low: 100,
                close: 103,
                adjustedClose: 102,
                volume: 2000,
                currency: "USD",
                exchange: "TEST",
                collectedAt: new Date().toISOString(),
              },
            ]
          : [],
      exportStocks: async (symbol) => {
        window.__uiTest.stockExports.push(symbol ?? "all");
        return { path: "C:/fixture/export.csv", rows: stockState.totalRows };
      },
      cancelStockCollection: async () => {},
      openStockFolder: async () => "",
      getLocalModels: async () => localModels,
      setLocalModel: async (input) => {
        if (window.__uiTest.modelFailure)
          throw Error("Fixture model change failed");
        window.__uiTest.modelSelection = input;
        localModels.defaultModel = `ollama/${input.model}`;
        localModels.contextWindow = input.contextWindow;
        localModels.thinking = input.thinking;
        return {
          model: localModels.defaultModel,
          contextWindow: input.contextWindow,
        };
      },
      getSettings: async () => settings,
      getStatus: async () => ({
        state: "disconnected",
        detail: "Fixture gateway is offline",
      }),
      getSetupStatus: async () => ({
        ollamaReachable: true,
        configuredModel: "Local test model",
      }),
      on: (name, fn) => {
        (events[name] ||= []).push(fn);
        return () => {
          events[name] = events[name].filter((item) => item !== fn);
        };
      },
      listAgents: async () => [{ id: "main" }],
      listModels: async () => [],
      listConversations: async () => [],
      createConversation: async () => ({
        key: "fixture-session",
        agentId: "main",
        title: "Fixture conversation",
      }),
      loadHistory: async () => {},
      sendMessage: async (input) => {
        if (window.__uiTest.failSend) throw Error("Fixture send failure");
        window.__uiTest.emit("conversation:messages", {
          sessionKey: input.sessionKey,
          messages: [
            { id: "1", role: "user", content: input.message, createdAt: 0 },
            {
              id: "2",
              role: "assistant",
              content: "Fixture reply",
              createdAt: 0,
            },
          ],
        });
        return { runId: "fixture-run" };
      },
      startGateway: async () => {
        window.__uiTest.emit("gateway:status", {
          state: "idle",
          detail: "Connected",
        });
        return { state: "idle" };
      },
      saveSettings: async (next) => {
        window.__uiTest.saves++;
        return { settings: next };
      },
      chooseAttachmentFiles: async () => [
        {
          id: "file",
          name: "example.csv",
          type: "text/csv",
          windowsPath: "C:/fixture/example.csv",
        },
      ],
      chooseFileAccessPaths: async () => ["C:/fixture/documents"],
      tailLogs: async () => [],
      getLogsPath: async () => ({ file: "fixture.log", folder: "fixture" }),
    };
  });
  await page.goto(baseURL);
  await page.getByRole("heading", { name: /What would you like/ }).waitFor();
  return { page, close: () => context.close() };
}

async function connect(page) {
  await page.evaluate(() =>
    window.__uiTest.emit("gateway:status", {
      state: "idle",
      detail: "Connected",
    }),
  );
  await page.getByRole("button", { name: /Local assistant ready/ }).waitFor();
}

test("stock workspace saves a watchlist and schedule, charts collected data, and exports", async () => {
  const f = await renderer();
  try {
    await f.page
      .getByRole("button", { name: "Stock data", exact: true })
      .click();
    await f.page
      .getByRole("textbox", { name: "Add stock tickers" })
      .fill("aapl, SPY, AAPL");
    await f.page.getByRole("button", { name: "Add", exact: true }).click();
    await f.page
      .getByRole("combobox", { name: "Chart ticker" })
      .selectOption("SPY");
    await f.page
      .getByRole("checkbox", { name: "Automatic stock collection" })
      .check();
    await f.page
      .getByRole("textbox", { name: "Collection time" })
      .fill("21:15");
    await f.page
      .getByRole("button", { name: "Save schedule", exact: true })
      .click();
    await f.page
      .getByRole("status")
      .filter({ hasText: "Schedule saved" })
      .waitFor();
    const saved = await f.page.evaluate(() => window.__uiTest.stocks.settings);
    assert.deepEqual(saved.symbols, ["AAPL", "SPY"]);
    assert.equal(saved.enabled, true);
    assert.equal(saved.time, "21:15");
    await f.page
      .getByRole("button", { name: "Collect now", exact: true })
      .click();
    await f.page
      .getByRole("img", { name: /SPY daily closing prices/ })
      .waitFor();
    await f.page
      .getByRole("button", { name: "Export CSV", exact: true })
      .click();
    await f.page
      .getByRole("status")
      .filter({ hasText: "Exported 4 rows" })
      .waitFor();
    assert.deepEqual(
      await f.page.evaluate(() => window.__uiTest.stockExports),
      ["all"],
    );
  } finally {
    await f.close();
  }
});
test("stock settings retain edits on failure and block controls during collection", async () => {
  const f = await renderer();
  try {
    await f.page
      .getByRole("button", { name: "Stock data", exact: true })
      .click();
    await f.page
      .getByRole("textbox", { name: "Add stock tickers" })
      .fill("AAPL");
    await f.page.evaluate(() => (window.__uiTest.stockSaveFailure = true));
    await f.page.getByRole("button", { name: "Add", exact: true }).click();
    await f.page
      .getByRole("alert")
      .filter({ hasText: "Fixture stock save failed" })
      .waitFor();
    assert.equal(
      await f.page
        .getByRole("textbox", { name: "Add stock tickers" })
        .inputValue(),
      "AAPL",
    );
    await f.page.evaluate(() => {
      window.__uiTest.stockSaveFailure = false;
    });
    await f.page.getByRole("button", { name: "Add", exact: true }).click();
    await f.page
      .getByRole("status")
      .filter({ hasText: "Watchlist saved" })
      .waitFor();
    await f.page.evaluate(() => {
      const state = window.__uiTest.stocks;
      state.active = {
        id: "in-flight",
        startedAt: new Date().toISOString(),
        trigger: "manual",
        status: "running",
        symbols: ["AAPL"],
        completed: 0,
        rows: 0,
        errors: [],
        warnings: [],
      };
      window.__uiTest.emit("stocks:changed", structuredClone(state));
    });
    await f.page.getByRole("button", { name: "Stop", exact: true }).waitFor();
    assert(
      await f.page
        .getByRole("textbox", { name: "Add stock tickers" })
        .isDisabled(),
    );
    assert(
      await f.page
        .getByRole("button", { name: "Save schedule", exact: true })
        .isDisabled(),
    );
    assert(
      await f.page
        .getByRole("button", { name: "Stop", exact: true })
        .isEnabled(),
    );
  } finally {
    await f.close();
  }
});
test("stock dashboard remains usable at the minimum supported window", async () => {
  const f = await renderer({ width: 900, height: 640 });
  try {
    await f.page
      .getByRole("button", { name: "Stock data", exact: true })
      .click();
    await f.page
      .getByRole("textbox", { name: "Add stock tickers" })
      .fill("SPY");
    await f.page.getByRole("button", { name: "Add", exact: true }).click();
    await f.page
      .getByRole("button", { name: "Save schedule", exact: true })
      .scrollIntoViewIfNeeded();
    assert(
      await f.page
        .getByRole("button", { name: "Save schedule", exact: true })
        .isVisible(),
    );
    assert(
      await f.page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  } finally {
    await f.close();
  }
});

test("overview explains the offline state and opens stock collection independently", async () => {
  const f = await renderer();
  try {
    await f.page.getByText("First, let’s connect your assistant.").waitFor();
    assert.equal(
      await f.page
        .getByRole("button", { name: /Local assistant ready/ })
        .count(),
      0,
    );
    await f.page
      .getByRole("button", { name: "Open stock data collection" })
      .click();
    await f.page.getByRole("heading", { name: "Price history" }).waitFor();
    assert(
      await f.page
        .getByRole("button", { name: "Collect now", exact: true })
        .isDisabled(),
    );
  } finally {
    await f.close();
  }
});

test("drafts survive connection settings and offline sending is disabled", async () => {
  const f = await renderer();
  try {
    await f.page
      .getByRole("button", { name: "New conversation", exact: true })
      .first()
      .click();
    await f.page
      .getByRole("textbox", { name: "Message your assistant" })
      .fill("Keep this draft");
    assert(
      await f.page
        .getByRole("button", { name: "Send message", exact: true })
        .isDisabled(),
    );
    await f.page
      .getByRole("button", { name: "Connection & settings", exact: true })
      .click();
    await f.page
      .getByRole("button", { name: "Conversations", exact: true })
      .click();
    assert.equal(
      await f.page
        .getByRole("textbox", { name: "Message your assistant" })
        .inputValue(),
      "Keep this draft",
    );
  } finally {
    await f.close();
  }
});

test("failed sends retain text and retry succeeds without duplicating a conversation", async () => {
  const f = await renderer();
  try {
    await connect(f.page);
    await f.page
      .getByRole("button", { name: "New conversation", exact: true })
      .first()
      .click();
    await f.page
      .getByRole("textbox", { name: "Message your assistant" })
      .fill("Test request");
    await f.page.evaluate(() => {
      window.__uiTest.failSend = true;
    });
    await f.page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await f.page
      .getByRole("alert")
      .filter({ hasText: "Fixture send failure" })
      .waitFor();
    assert.equal(
      await f.page
        .getByRole("textbox", { name: "Message your assistant" })
        .inputValue(),
      "Test request",
    );
    await f.page.evaluate(() => {
      window.__uiTest.failSend = false;
    });
    await f.page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await f.page.getByText("Fixture reply", { exact: true }).waitFor();
    assert.equal(
      await f.page
        .getByRole("textbox", { name: "Message your assistant" })
        .inputValue(),
      "",
    );
  } finally {
    await f.close();
  }
});

test("connection settings support keyboard tabs and reject invalid addresses", async () => {
  const f = await renderer();
  try {
    await f.page
      .getByRole("button", { name: "Connection & settings", exact: true })
      .click();
    assert.equal(
      await f.page.getByLabel("Access token", { exact: true }).count(),
      0,
    );
    await f.page.getByRole("tab", { name: "Connection", exact: true }).focus();
    await f.page.keyboard.press("ArrowRight");
    assert.equal(
      await f.page
        .getByRole("tab", { name: "Folder access" })
        .getAttribute("aria-selected"),
      "true",
    );
    await f.page
      .getByRole("button", { name: "Add folders", exact: true })
      .click();
    await f.page.getByText("C:/fixture/documents", { exact: true }).waitFor();
    await f.page.getByRole("tab", { name: "Connection", exact: true }).click();
    await f.page
      .getByLabel("Connection address", { exact: true })
      .fill("https://invalid.example");
    await f.page
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await f.page.getByRole("alert").filter({ hasText: "ws://" }).waitFor();
    assert.equal(await f.page.evaluate(() => window.__uiTest.saves), 0);
    await f.page
      .getByLabel("Connection address", { exact: true })
      .fill("ws://127.0.0.1:18789");
    await f.page
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await f.page
      .getByRole("status")
      .filter({ hasText: "Settings saved" })
      .waitFor();
  } finally {
    await f.close();
  }
});

test("file selection opens a draft with a visible attachment", async () => {
  const f = await renderer();
  try {
    await f.page
      .getByRole("button", { name: "Files & folders", exact: true })
      .click();
    await f.page
      .getByRole("button", { name: "Choose files", exact: true })
      .click();
    await f.page.getByText("example.csv", { exact: true }).waitFor();
    assert.match(
      await f.page
        .getByRole("textbox", { name: "Message your assistant" })
        .inputValue(),
      /understand these files/,
    );
  } finally {
    await f.close();
  }
});

test("minimum supported window scrolls without hiding settings actions", async () => {
  const f = await renderer({ width: 900, height: 584 }); // 640px window minus native chrome.
  try {
    await f.page
      .getByRole("button", { name: "Connection & settings", exact: true })
      .click();
    const save = f.page.getByRole("button", {
      name: "Save settings",
      exact: true,
    });
    await save.scrollIntoViewIfNeeded();
    const box = await save.boundingBox();
    assert(box && box.y >= 0 && box.y + box.height <= 584);
    assert(
      await f.page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await f.page.getByRole("tab", { name: "Advanced & diagnostics" }).click();
    await save.scrollIntoViewIfNeeded();
    assert(await save.isVisible());
  } finally {
    await f.close();
  }
});

test("local model settings apply an explicit installed model, context, and reasoning style", async () => {
  const f = await renderer();
  try {
    await f.page
      .getByRole("button", { name: "Connection & settings", exact: true })
      .click();
    await f.page
      .getByRole("combobox", { name: "Default local model", exact: true })
      .selectOption("qwen3.6:27b");
    await f.page
      .getByRole("combobox", { name: "Model context size", exact: true })
      .selectOption("16384");
    await f.page
      .getByRole("checkbox", { name: /Use extended reasoning/ })
      .check();
    await f.page
      .getByRole("button", { name: "Use model", exact: true })
      .click();
    await f.page
      .getByRole("status")
      .filter({ hasText: "qwen3.6:27b is selected" })
      .waitFor();
    assert.deepEqual(
      await f.page.evaluate(() => window.__uiTest.modelSelection),
      { model: "qwen3.6:27b", contextWindow: 16384, thinking: true },
    );
  } finally {
    await f.close();
  }
});

test("failed model changes keep the selection visible and can be retried", async () => {
  const f = await renderer();
  try {
    await f.page
      .getByRole("button", { name: "Connection & settings", exact: true })
      .click();
    await f.page
      .getByRole("combobox", { name: "Default local model", exact: true })
      .selectOption("qwen3.6:27b");
    await f.page.evaluate(() => {
      window.__uiTest.modelFailure = true;
    });
    await f.page
      .getByRole("button", { name: "Use model", exact: true })
      .click();
    await f.page
      .getByRole("alert")
      .filter({ hasText: "Fixture model change failed" })
      .waitFor();
    assert.equal(
      await f.page
        .getByRole("combobox", { name: "Default local model", exact: true })
        .inputValue(),
      "qwen3.6:27b",
    );
    assert.equal(
      await f.page.evaluate(() => window.__uiTest.modelSelection),
      null,
    );
    await f.page.evaluate(() => {
      window.__uiTest.modelFailure = false;
    });
    await f.page
      .getByRole("button", { name: "Use model", exact: true })
      .click();
    await f.page
      .getByRole("status")
      .filter({ hasText: "qwen3.6:27b is selected" })
      .waitFor();
  } finally {
    await f.close();
  }
});

test("conversation picker passes the current session and is disabled during a run", async () => {
  const f = await renderer();
  try {
    await connect(f.page);
    await f.page
      .getByRole("button", { name: "New conversation", exact: true })
      .first()
      .click();
    await f.page
      .getByRole("textbox", { name: "Message your assistant" })
      .fill("Create this test conversation");
    await f.page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await f.page.getByText("Fixture reply", { exact: true }).waitFor();
    await f.page
      .getByRole("combobox", { name: "Conversation model", exact: true })
      .selectOption("qwen3.6:27b");
    await f.page
      .getByRole("button", { name: "Use model", exact: true })
      .click();
    await f.page
      .getByRole("status")
      .filter({ hasText: "qwen3.6:27b is selected" })
      .waitFor();
    assert.equal(
      (await f.page.evaluate(() => window.__uiTest.modelSelection)).sessionKey,
      "fixture-session",
    );
    await f.page.evaluate(() =>
      window.__uiTest.emit("gateway:status", {
        state: "running",
        activeRun: {
          sessionKey: "fixture-session",
          runId: "fixture-run",
          startedAt: Date.now(),
          activity: "Working",
        },
      }),
    );
    await f.page
      .getByText("Wait for the current run to finish before changing models.", {
        exact: true,
      })
      .waitFor();
    assert(
      await f.page
        .getByRole("button", { name: "Use model", exact: true })
        .isDisabled(),
    );
  } finally {
    await f.close();
  }
});
