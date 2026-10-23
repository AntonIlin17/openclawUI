import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  configureLocalModel,
  modelUpdateCommand,
  modelUpdateScript,
} from "../src/main/model-config.js";
import { installedLocalModels } from "../src/main/local-models.js";
import {
  validateLocalModelSelection,
  type LocalModel,
} from "../src/shared/local-models.js";

const model: LocalModel = {
  name: "qwen3.5:9b",
  sizeBytes: 6600000000,
  parameterSize: "9B",
  quantization: "Q4_K_M",
  tools: true,
  vision: true,
  reasoning: true,
};
const selection = { model: model.name, contextWindow: 32768, thinking: false };
const config = {
  gateway: { auth: { token: "test-secret" } },
  tools: { web: { search: { provider: "ollama" } } },
  models: {
    providers: {
      ollama: {
        baseUrl: "http://127.0.0.1:11434",
        apiKey: "local-test-key",
        models: [{ id: "gemma4:e4b", contextWindow: 131072 }],
      },
      another: { baseUrl: "http://localhost:8000" },
    },
  },
  agents: {
    defaults: {
      model: { primary: "ollama/gemma4:e4b", fallbacks: ["ollama/another"] },
      models: { "ollama/gemma4:e4b": {} },
    },
  },
};

test("local model configuration preserves credentials, search, fallbacks, and existing models", () => {
  const original = structuredClone(config);
  const updated = configureLocalModel(config, selection, model);
  assert.deepEqual(config, original);
  assert.deepEqual(updated.gateway, config.gateway);
  assert.deepEqual(updated.tools, config.tools);
  assert.deepEqual(
    updated.models.providers.another,
    config.models.providers.another,
  );
  assert.equal(updated.models.providers.ollama.apiKey, "local-test-key");
  assert.deepEqual(updated.agents.defaults.model.fallbacks, ["ollama/another"]);
  assert.equal(updated.agents.defaults.model.primary, "ollama/qwen3.5:9b");
  assert.equal(updated.agents.defaults.contextTokens, 32768);
  assert.equal(updated.models.providers.ollama.models.length, 2);
  assert.equal(updated.models.providers.ollama.models[1].params.num_ctx, 32768);
  assert.equal(
    updated.models.providers.ollama.models[1].params.thinking,
    false,
  );
  assert.deepEqual(updated.models.providers.ollama.models[1].input, [
    "text",
    "image",
  ]);
  assert("ollama/gemma4:e4b" in updated.agents.defaults.models);
  assert("ollama/qwen3.5:9b" in updated.agents.defaults.models);
});

test("selection rejects cloud models, shell text, unsupported contexts, and chat-only models", () => {
  for (const name of ["qwen:cloud", "bad;whoami", "$(whoami)", "`whoami`", ""])
    assert.throws(() =>
      validateLocalModelSelection({ ...selection, model: name }),
    );
  assert.throws(() =>
    validateLocalModelSelection({ ...selection, contextWindow: 131072 }),
  );
  assert.throws(() =>
    configureLocalModel(config, selection, { ...model, tools: false }),
  );
  const cloud = structuredClone(config);
  cloud.models.providers.ollama.baseUrl = "https://ollama.com";
  assert.throws(() => configureLocalModel(cloud, selection, model));
});

test("config update script creates an exact backup and does not put credentials into command text", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "openclaw-model-test-"));
  try {
    const target = path.join(directory, "openclaw.json");
    const original = JSON.stringify(config, null, 2);
    writeFileSync(target, original);
    const script = modelUpdateScript(selection, model, target);
    assert(!script.includes("test-secret"));
    assert(!modelUpdateCommand(selection, model).includes("test-secret"));
    assert(!modelUpdateCommand(selection, model).includes("${"));
    const output = execFileSync(process.execPath, ["-e", script], {
      encoding: "utf8",
    });
    assert.equal(JSON.parse(output).model, "ollama/qwen3.5:9b");
    const backup = readdirSync(directory).find((name) =>
      name.includes(".desktop-model-backup-"),
    );
    assert(backup);
    assert.equal(readFileSync(path.join(directory, backup), "utf8"), original);
    assert.equal(
      JSON.parse(readFileSync(target, "utf8")).gateway.auth.token,
      "test-secret",
    );
    assert(!readdirSync(directory).some((name) => name.endsWith(".tmp")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("installed model discovery filters remote/cloud aliases and reads real capabilities", async () => {
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/tags") {
      res.end(
        JSON.stringify({
          models: [
            {
              name: "local:9b",
              size: 6000000000,
              details: { parameter_size: "9B" },
            },
            { name: "large:cloud", size: 1 },
            { name: "alias:latest", size: 1 },
            { name: "chat:1b", size: 1000 },
          ],
        }),
      );
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const name = JSON.parse(body).model;
    res.end(
      JSON.stringify(
        name === "alias:latest"
          ? { remote_host: "https://ollama.com", capabilities: ["tools"] }
          : {
              capabilities:
                name === "chat:1b"
                  ? ["completion"]
                  : ["tools", "vision", "thinking"],
            },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    const models = await installedLocalModels(
      `http://127.0.0.1:${address.port}`,
    );
    assert.deepEqual(
      models.map((item) => item.name),
      ["chat:1b", "local:9b"],
    );
    assert.equal(models[0].tools, false);
    assert.equal(models[1].tools, true);
    assert.equal(models[1].vision, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
