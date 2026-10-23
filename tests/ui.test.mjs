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
  page.on("pageerror", error => console.error("RENDERER_ERROR", error.message));
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
    };
    window.openclaw = {
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

test("overview explains the offline state and labels unfinished stock collection", async () => {
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
      .getByRole("button", { name: "View stock collection plan" })
      .click();
    await f.page
      .getByRole("dialog")
      .getByText("No collection or schedule is running yet.", { exact: false })
      .waitFor();
    await f.page.keyboard.press("Escape");
    assert.equal(await f.page.getByRole("dialog").count(), 0);
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
