import type {
  LocalModel,
  LocalModelSelection,
} from "../shared/local-models.js";
import { validateLocalModelSelection } from "../shared/local-models.js";

const object = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

// Pure transformation: retain unrelated settings, credentials, search provider,
// model fallbacks and other providers. The caller owns backup/atomic persistence.
export function configureLocalModel(
  original: Record<string, unknown>,
  selection: LocalModelSelection,
  model: LocalModel,
): Record<string, any> {
  validateLocalModelSelection(selection);
  if (model.name !== selection.model || !model.tools)
    throw new Error(
      "This installed model does not advertise tool support. Choose a tool-capable model for OpenClaw.",
    );
  const config = structuredClone(original) as Record<string, any>;
  config.models = object(config.models);
  config.models.providers = object(config.models.providers);
  const provider = object(config.models.providers.ollama);
  if (
    !provider.baseUrl ||
    /https?:\/\/(?:www\.)?ollama\.com(?:[/:]|$)/i.test(provider.baseUrl)
  )
    throw new Error(
      "Configure a local Ollama endpoint in OpenClaw before selecting a local model.",
    );
  const list = Array.isArray(provider.models) ? provider.models : [];
  const previous = object(list.find((entry: any) => entry.id === model.name));
  const entry = {
    ...previous,
    id: model.name,
    name: model.name,
    reasoning: model.reasoning,
    input: model.vision ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: selection.contextWindow,
    maxTokens: 4096,
    compat: {
      ...object(previous.compat),
      supportsTools: true,
      supportsUsageInStreaming: true,
    },
    params: {
      ...object(previous.params),
      num_ctx: selection.contextWindow,
      keep_alive: "5m",
      ...(model.reasoning ? { thinking: selection.thinking } : {}),
    },
  };
  provider.api = "ollama";
  provider.timeoutSeconds = Math.max(Number(provider.timeoutSeconds) || 0, 300);
  provider.models = [
    ...list.filter((item: any) => item.id !== model.name),
    entry,
  ];
  config.models.providers.ollama = provider;
  config.agents = object(config.agents);
  config.agents.defaults = object(config.agents.defaults);
  const defaults = config.agents.defaults;
  defaults.model = {
    ...object(defaults.model),
    primary: `ollama/${model.name}`,
  };
  defaults.contextTokens = selection.contextWindow;
  if (defaults.models && typeof defaults.models === "object")
    defaults.models[`ollama/${model.name}`] ??= {};
  return config;
}

export function modelUpdateScript(
  selection: LocalModelSelection,
  model: LocalModel,
  configPath?: string,
): string {
  validateLocalModelSelection(selection);
  // Only public model metadata travels through process arguments. Credentials
  // remain in the config file on the WSL host and never enter command/log text.
  const payload = Buffer.from(JSON.stringify({ selection, model })).toString(
    "base64",
  );
  return [
    "const fs = require('node:fs'); const path = require('node:path');",
    `const validateLocalModelSelection = ${validateLocalModelSelection.toString()};`,
    `const object = ${object.toString()};`,
    `const configureLocalModel = ${configureLocalModel.toString()};`,
    `const input = JSON.parse(Buffer.from('${payload}', 'base64').toString('utf8'));`,
    `const configPath = ${configPath ? JSON.stringify(configPath) : "path.join(process.env.HOME, '.openclaw', 'openclaw.json')"};`,
    "const original = fs.readFileSync(configPath, 'utf8');",
    "const updated = configureLocalModel(JSON.parse(original), input.selection, input.model);",
    "const backup = configPath + '.desktop-model-backup-' + Date.now();",
    "fs.writeFileSync(backup, original, {mode: 0o600, flag: 'wx'});",
    "const temporary = configPath + '.desktop-model-' + process.pid + '.tmp';",
    "fs.writeFileSync(temporary, JSON.stringify(updated, null, 2) + '\\n', {mode: 0o600, flag: 'wx'});",
    "fs.renameSync(temporary, configPath);",
    "console.log(JSON.stringify({ model: updated.agents.defaults.model.primary, contextWindow: input.selection.contextWindow }));",
  ].join("\n");
}

export function modelUpdateCommand(
  selection: LocalModelSelection,
  model: LocalModel,
): string {
  const encoded = Buffer.from(modelUpdateScript(selection, model)).toString(
    "base64",
  );
  // WSL's Windows argument conversion can reparse quotes. Encode the trusted
  // script so no model name, dollar sign, or JS template literal reaches a shell.
  return `node -e "eval(Buffer.from('${encoded}','base64').toString('utf8'))"`;
}
