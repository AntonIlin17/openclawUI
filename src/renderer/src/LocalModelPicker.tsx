import React, { useEffect, useState } from "react";
import { Bot, Check, LoaderCircle, RefreshCw } from "lucide-react";
import type { LocalModelsState } from "../../shared/local-models";

export function LocalModelPicker({
  compact = false,
  sessionKey,
  activeModel,
  disabled = false,
  onApplied,
}: {
  compact?: boolean;
  sessionKey?: string;
  activeModel?: string;
  disabled?: boolean;
  onApplied?: (model: string) => void;
}) {
  const [inventory, setInventory] = useState<LocalModelsState | null>(null);
  const [model, setModel] = useState("");
  const [context, setContext] = useState(32768);
  const [thinking, setThinking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const next = await window.openclaw.getLocalModels();
      setInventory(next);
      const current = (activeModel ?? next.defaultModel ?? "").replace(
        /^ollama\//,
        "",
      );
      setModel(
        next.models.some((item) => item.name === current)
          ? current
          : (next.models.find((item) => item.tools)?.name ?? ""),
      );
      setContext(
        next.contextWindow && [16384, 32768, 65536].includes(next.contextWindow)
          ? next.contextWindow
          : 32768,
      );
      setThinking(next.thinking ?? false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [activeModel, sessionKey]);
  const selected = inventory?.models.find((item) => item.name === model);

  async function apply() {
    if (!selected?.tools || disabled || applying) return;
    setApplying(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.openclaw.setLocalModel({
        model,
        contextWindow: context,
        thinking: selected.reasoning && thinking,
        ...(sessionKey ? { sessionKey } : {}),
      });
      setInventory((current) =>
        current
          ? {
              ...current,
              defaultModel: result.model,
              contextWindow: result.contextWindow,
              thinking,
            }
          : current,
      );
      setNotice(
        `${model} is selected${sessionKey ? " for this conversation and new conversations" : " for new conversations"}.`,
      );
      onApplied?.(result.model);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  }

  return (
    <section
      className={`local-model-picker ${compact ? "compact" : ""}`}
      aria-label="Local model selection"
    >
      {!compact ? (
        <div className="section-heading">
          <div>
            <h2>
              <Bot size={18} /> Choose your local model
            </h2>
            <p>
              Models installed in Ollama on this computer. Larger models need
              more memory and can be slower.
            </p>
          </div>
          <button
            className="text-button"
            onClick={() => void load()}
            disabled={loading || applying}
            title="Refresh installed models"
          >
            <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh
          </button>
        </div>
      ) : null}
      {loading ? (
        <p className="model-notice" role="status">
          <LoaderCircle className="spin" size={14} /> Checking installed models…
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void apply();
          }}
        >
          <div className="model-form-row">
            <label>
              Local model
              <select
                aria-label={
                  compact ? "Conversation model" : "Default local model"
                }
                value={model}
                disabled={applying || disabled || !inventory?.models.length}
                onChange={(event) => {
                  setModel(event.target.value);
                  setNotice(null);
                }}
              >
                <option value="" disabled>
                  Choose an installed model
                </option>
                {inventory?.models.map((item) => (
                  <option
                    key={item.name}
                    value={item.name}
                    disabled={!item.tools}
                  >
                    {item.name} · {(item.sizeBytes / 1073741824).toFixed(1)} GB
                    {!item.tools ? " · no tool support" : ""}
                  </option>
                ))}
              </select>
            </label>
            {!compact ? (
              <label>
                Conversation context
                <select
                  aria-label="Model context size"
                  value={context}
                  onChange={(event) => setContext(Number(event.target.value))}
                  disabled={applying || disabled}
                >
                  <option value={16384}>16K · lower memory</option>
                  <option value={32768}>32K · balanced</option>
                  <option value={65536}>64K · more memory</option>
                </select>
              </label>
            ) : null}
            <button
              className="primary-button"
              type="submit"
              disabled={applying || disabled || !selected?.tools}
            >
              {applying ? (
                <>
                  <LoaderCircle size={14} className="spin" /> Applying…
                </>
              ) : (
                <>
                  <Check size={14} /> Use model
                </>
              )}
            </button>
          </div>
          {!compact ? (
            <>
              <label className="model-reasoning">
                <input
                  type="checkbox"
                  checked={thinking}
                  disabled={applying || disabled || !selected?.reasoning}
                  onChange={(event) => setThinking(event.target.checked)}
                />{" "}
                Use extended reasoning{" "}
                <span>Can improve difficult answers, but takes longer.</span>
              </label>
              <p className="caption">
                Context controls how much the model can read at once. Start with
                32K; choose 16K if memory is tight. Applying saves a backup of
                your OpenClaw configuration and briefly reconnects the
                assistant.
              </p>
              <p className="caption">
                Current default:{" "}
                <strong>
                  {inventory?.defaultModel?.replace(/^ollama\//, "") ??
                    "Not configured"}
                </strong>
              </p>
            </>
          ) : (
            <p className="caption">
              {sessionKey
                ? "Applies to this conversation and becomes the default for new ones."
                : "Choose the model for your next conversation."}{" "}
              Context and reasoning options are in Connection & settings.
            </p>
          )}
        </form>
      )}
      {!loading && !inventory?.models.length && !error ? (
        <p className="model-notice">
          No local models found. Download a tool-capable model in Ollama, then
          refresh.
        </p>
      ) : null}
      {applying ? (
        <p className="model-notice" role="status">
          Saving the model and reconnecting OpenClaw. This can take a few
          seconds.
        </p>
      ) : null}
      {disabled ? (
        <p className="caption">
          Wait for the current run to finish before changing models.
        </p>
      ) : null}
      {error ? (
        <p className="inline-error" role="alert">
          {error}{" "}
          <button
            className="text-button"
            disabled={applying}
            onClick={() => void load()}
          >
            Refresh models
          </button>
        </p>
      ) : null}
      {notice ? (
        <p className="model-notice success" role="status">
          <Check size={14} />
          {notice}
        </p>
      ) : null}
    </section>
  );
}
