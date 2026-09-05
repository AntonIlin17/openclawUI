# Build Prompt: OpenClaw Local Agent Runtime

> **This document is the complete task brief for the implementing agent.**
> Read it end to end before writing code. It defines the target, the
> architecture, the constraints, the phasing, and the acceptance criteria.
> Where it says MUST, that is a hard requirement. Where it says SHOULD,
> deviate only with a written justification in your PR description.

---

## 1. Mission

Rewrite `openclawUI` from a thin chat client for an external gateway into a
**self-contained local AI agent runtime** for Windows.

The owner's goal, in their words: a "Jarvis"-like agent attached to their
computer — a coding agent, a deep-research agent, and a computer-use agent —
running on free, local, open-weight models, with **zero terminal use and zero
dependence on any separately-launched app such as Ollama or LM Studio.**

The single sentence that defines done:

> The user double-clicks one icon. The app opens. They pick a model from a
> dropdown, it loads, and they can give it a real multi-step task that it
> completes using tools. Nothing else was launched by hand.

---

## 2. Hardware Target

Build and tune for exactly this machine. Do not write for a hypothetical
range of hardware; write for this box and degrade gracefully elsewhere.

| Component | Spec | Consequence for design |
|---|---|---|
| GPU | **NVIDIA RTX 5070 Ti, 16 GB GDDR7** | Blackwell, compute capability **sm_120**. Requires CUDA 12.8+ builds. 16 GB is the hard budget for weights + KV cache. |
| CPU | **Intel Core i9-14900K** (8P+16E) | Strong enough that CPU-offloading MoE experts is genuinely viable, not a fallback of last resort. |
| RAM | **32 GB** | Total practical model budget is ~44 GB (16 VRAM + ~28 usable RAM). Anything needing >40 GB is out of scope. |
| Storage | 1.86 TB, ~860 GB free | Model storage must be managed — a full catalog would exceed this. Disk accounting is a required feature, not a nice-to-have. |
| OS | Windows (x64) | **Native Windows is a requirement.** See §4.1. |

### 2.1 Critical known issue — do not ignore

llama.cpp under CUDA on **Blackwell/SM120 inside WSL2 hangs
non-deterministically** — the same command succeeds once and hangs on an
identical rerun. This is reported against an RTX 5070 Ti specifically:
<https://github.com/Microsoft/wsl/issues/41361>. Related sm_120 build issues:
<https://github.com/ggml-org/llama.cpp/issues/22696>.

This is not a preference. **Running inference through WSL2 on this machine is
a correctness bug.** The migration to native Windows inference is mandatory
and this is the reason.

---

## 3. Current State of the Repository

Electron + React + TypeScript + Vite. ~3,300 lines. Read these before changing
anything:

| File | Lines | What it is | Disposition |
|---|---|---|---|
| `src/main/main.ts` | 937 | Electron main; window, tray, IPC, lifecycle, gateway orchestration | **Gut and rewrite.** Keep tray/window/updater/single-instance logic. |
| `src/main/gateway-client.ts` | 567 | WebSocket client for the OpenClaw gateway protocol | **Delete.** Replaced by the local engine + agent loop. |
| `src/main/wsl.ts` | 230 | Spawns `wsl.exe`, path translation, config reading | **Delete.** No WSL in the new design. |
| `src/main/settings.ts` | 88 | JSON settings with `safeStorage` encryption | **Keep and extend.** The encryption pattern is correct — reuse it for API keys. |
| `src/main/logger.ts` | 197 | Structured file logging | **Keep.** Extend with per-subsystem scopes. |
| `src/main/export.ts` | 84 | Markdown/PDF conversation export | **Keep.** |
| `src/renderer/src/App.tsx` | 875 | Entire UI in one file | **Decompose.** Keep the markdown/KaTeX/mermaid/highlight rendering — it works. |
| `src/shared/types.ts` | 143 | Shared types | **Extend heavily.** |
| `src/preload/preload.ts` | 41 | Context bridge | **Extend.** Keep `contextIsolation`. |

Deliberately preserved dependencies: `react-markdown`, `remark-gfm`,
`remark-math`, `rehype-katex`, `katex`, `highlight.js`, `mermaid`,
`html2pdf.js`, `electron-updater`, `lucide-react`. Do not churn these.

**Remove from settings and types:** `gatewayUrl`, `host`, `port`, `wslDistro`,
`gatewayCommand`, `modelStartCommand`, `authMode`, `token`, `password`,
`prefetchFileListings`. Write a settings migration that drops them silently.

---

## 4. Architecture

### 4.1 Process topology

Everything below runs on native Windows, spawned and supervised by the Electron
main process. No WSL. No user-launched apps.

```
┌──────────────────────────────────────────────────────────┐
│  Electron Main  (Node)                                   │
│  ├─ Supervisor      spawn/health/restart/teardown        │
│  ├─ Agent Loop      tool-calling orchestration           │
│  ├─ Tool Registry   files │ shell │ browser │ search │…  │
│  ├─ Permission Gate every tool call passes through here  │
│  ├─ Model Manager   catalog │ download │ VRAM planner    │
│  └─ Store           SQLite: convos, memory, vectors      │
└───────┬──────────────┬───────────────┬──────────────────┘
        │ spawn        │ spawn         │ spawn
   ┌────▼─────┐  ┌─────▼──────┐  ┌─────▼──────┐
   │llama-swap│  │ Chromium   │  │  SearXNG   │
   │  :8081   │  │ (Playwright│  │  (optional)│
   │    │     │  │  CDP)      │  │            │
   │ ┌──▼───┐ │  └────────────┘  └────────────┘
   │ │llama-│ │
   │ │server│ │  ← the actual GGUF inference process
   │ └──────┘ │
   └──────────┘
        ▲ IPC (contextIsolation, typed channels)
        │
┌───────┴──────────────────────────────────────────────────┐
│  Renderer (React)  — chat, model bar, diffs, terminal    │
└──────────────────────────────────────────────────────────┘
```

### 4.2 Inference engine decision — DECIDED, do not re-litigate

**Bundle `llama.cpp` (`llama-server.exe`) fronted by `llama-swap.exe`.**

- llama.cpp upstream: <https://github.com/ggml-org/llama.cpp>
- llama-swap: <https://github.com/mostlygeek/llama-swap> (Go, zero-dependency,
  single binary, OpenAI-compatible, purpose-built for on-demand model swapping)

Rationale, since the owner delegated this choice:

1. **Ollama hides the knobs that decide whether a model fits in 16 GB.**
   Per-model MoE expert offload (`--n-cpu-moe`), KV cache quantization
   (`--cache-type-k/-v q8_0`), per-model context size, flash attention, and
   speculative decoding with a draft model are the difference between
   "Qwen3-Coder-30B does not fit" and "it runs usefully." These must be
   first-class, per-model, user-invisible settings.
2. **llama-swap already solves hot-swap** — load-on-request, TTL unload,
   and a `groups`/matrix mode for holding a small VLM resident alongside a
   large text model. Do not write this yourself.
3. **Zero external installs** is the owner's primary requirement, and shipping
   the binaries is the only way to actually guarantee it.
4. **sm_120 control.** You must pin a CUDA 12.8+ toolchain build. With Ollama
   you inherit whatever they shipped.

Cost accepted: installer grows to roughly 1.5–2.5 GB with CUDA runtime DLLs.
Mitigate with a small installer that downloads the CUDA-enabled engine on
first run, with a CPU-only fallback bundled.

**Secondary backends (Phase 4, not before):** detect an existing Ollama
(`:11434`) or LM Studio (`:1234`) install and offer it as an alternate
provider. Both are OpenAI-compatible, so this is a provider registration, not
an architecture change. Never *require* them.

### 4.3 Engine acquisition and provisioning

On first run the app MUST provision its engine with no user terminal use:

1. Detect GPU via `nvidia-smi --query-gpu=name,memory.total,driver_version`.
2. Resolve compute capability; for sm_120 require a CUDA 12.8+ build.
3. Download the matching `llama.cpp` release asset from GitHub Releases,
   verify checksum, unpack to `%LOCALAPPDATA%\OpenClaw\engine\<version>\`.
4. Smoke test: start `llama-server` with a ~1 GB model, hit `/health`, run one
   completion, confirm GPU layers were actually offloaded (parse startup log
   for the offload line), then shut down.
5. If the CUDA path fails the smoke test, fall back to the CPU/Vulkan build,
   surface a clear banner, and log the reason. **Never leave the user at a
   blank screen with no explanation.**

Engine version is pinned in a manifest and updatable independently of the app.

---

## 5. Model Layer

### 5.1 VRAM planner — the feature that makes this usable

A 16 GB card means model choice is arithmetic, and the user must never do that
arithmetic. Implement a planner that, given a model + desired context length,
computes:

```
weights_bytes      ≈ params × bits_per_weight / 8       (from GGUF header)
kv_cache_bytes     ≈ 2 × n_layers × n_kv_heads × head_dim
                       × ctx_len × bytes_per_kv_element
overhead_bytes     ≈ 600 MB  (CUDA context, compute buffers, fragmentation)
```

Then emit a concrete launch plan:

- If `total ≤ vram_free − 1 GB` → full GPU offload (`-ngl 999`).
- Else if **MoE** → keep attention + shared experts on GPU, push routed experts
  to CPU with `--n-cpu-moe N`, solving for the largest N that fits. This is the
  key move on 16 GB and is why MoE models are strongly preferred here.
- Else if **dense** → reduce context, then quantize KV to `q8_0`, then `q4_0`,
  then step down the quant tier, then partial `-ngl`. Dense partial offload is
  slow; warn the user honestly rather than silently shipping 4 tok/s.
- Always reserve headroom for the display (Windows desktop uses ~0.5–1 GB).

The UI MUST show, per model, before download: estimated VRAM, estimated
tokens/sec, max comfortable context, and a plain-language verdict —
`Fits comfortably` / `Fits with CPU offload (slower)` / `Too large`.

### 5.2 Model catalog

Ship a **remote, versioned JSON manifest** (`models.json`), fetched with a
bundled copy as fallback. Do **not** hard-code the catalog in TypeScript — the
local model landscape moves monthly and the app must not need a release to
learn about a new model.

Schema per entry:

```jsonc
{
  "id": "qwen3-coder-30b-a3b",
  "name": "Qwen3-Coder 30B-A3B",
  "role": ["coding", "agentic"],          // routing hint
  "arch": "moe",                           // moe | dense
  "params_total": 30_500_000_000,
  "params_active": 3_300_000_000,
  "native_ctx": 262144,
  "license": "apache-2.0",
  "supports": { "tools": true, "vision": false, "reasoning": false },
  "quants": [
    { "tier": "Q4_K_M", "repo": "unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF",
      "file": "...Q4_K_M.gguf", "bytes": 18_600_000_000, "sha256": "..." }
  ],
  "draft_model": "qwen3-0.6b",             // for speculative decoding
  "launch_hints": { "cache_type_k": "q8_0", "flash_attn": true }
}
```

Downloads come from Hugging Face resolve URLs. Requirements: resumable
(HTTP Range), parallel chunks, SHA-256 verification, pause/cancel, progress
with ETA in the UI, and disk-space precheck. Multi-part GGUFs must be
reassembled or passed to llama.cpp as a split set.

### 5.3 Seeded model recommendations for this machine

> **Implementing agent: you MUST re-verify this list against primary sources
> (Hugging Face model cards, official org blogs, the llama.cpp support matrix)
> before shipping it.** It was compiled 2026-09-05 and the field moves fast.
> Web searches surfaced several plausible-but-unverified newer names —
> "Qwen3.6-35B-A3B", "Qwen3.8-27B", "GLM-5.2/5.3", "Gemma 4", "DeepSeek V4",
> "Kimi K2.6", "Mellum 2". Some are likely real; SEO content farms invent
> model names constantly. **Verify every entry has a real Hugging Face model
> card and a real GGUF conversion before it enters the catalog.** Entries below
> marked ✅ were confirmed to exist; ⚠️ means reported but unverified.

**Primary driver — agentic coding**
- ✅ `Qwen/Qwen3-Coder-30B-A3B-Instruct` — MoE 30B total / ~3.3B active,
  **262,144 native context**, tool-calling native. Q4_K_M ≈ 18.6 GB, so it
  does *not* fully fit 16 GB — but as MoE with `--n-cpu-moe` on a 14900K it
  runs well. **This should be the default coding model.**
- ✅ `mistralai/Devstral-Small-2-24B-Instruct-2512` — purpose-built agentic SWE
  model, dense 24B. Q4_K_M ≈ 14 GB, fits with modest context. Excellent at
  multi-file edits and tool loops; tight on KV headroom.
- ✅ `Qwen/Qwen2.5-Coder-14B-Instruct` — dense, ~9 GB at Q4_K_M, comfortable
  full offload with large context. The reliable fallback.

**Primary driver — general reasoning / research orchestration**
- ✅ `openai/gpt-oss-20b` — MoE 21B / 3.6B active, native MXFP4 ≈ 12–13 GB,
  fits fully, adjustable reasoning effort, strong tool calling, Apache 2.0.
  **This should be the default general/research model.** Note the sm_120 MXFP4
  build issue (<https://github.com/ggml-org/llama.cpp/issues/19662>) — verify
  it is resolved in your pinned engine build, or ship a GGUF requant.
- ✅ `Qwen/Qwen3-30B-A3B-Instruct-2507` and `-Thinking-2507` — same MoE shape
  as the coder; Thinking variant for hard multi-step research decomposition.
- ✅ `Qwen/Qwen3-14B` — dense, fits fully, good general agent.

**Vision / computer use** (needed for screen understanding)
- Qwen3-VL family (verify exact current sizes) — strongest open GUI grounding
  per the ScreenSpot-Pro literature. A ~7–8B VL at Q4 (~5–6 GB) can stay
  resident alongside a text model.
- ✅ `ByteDance UI-TARS` (<https://github.com/bytedance/ui-tars>) — screenshot
  in, mouse/keyboard actions out. Purpose-built for desktop control. Benchmarks
  vary; evaluate against Qwen3-VL before committing.
- Microsoft **OmniParser v2** — not an LLM; converts a screenshot into a
  structured element list. Pairing this with a text model is often more robust
  and cheaper than pure pixel grounding. Strongly consider it.

**Supporting models (small, always worth having)**
- Embeddings: Qwen3-Embedding-0.6B (~1 GB) or BGE-M3 — for research memory and
  codebase retrieval.
- Reranker: Qwen3-Reranker-0.6B — materially improves research quality.
- Draft model for speculative decoding: Qwen3-0.6B — pairs with the 14B/30B
  models for a real throughput win.
- STT: `whisper-large-v3-turbo` via whisper.cpp (~1.5 GB) or NVIDIA Parakeet.
- TTS: Piper (tiny, fast) or Kokoro-82M (better quality).

**Explicitly out of reach on this machine:** gpt-oss-120b (~63 GB), any 70B+
dense model, GLM-4.5-Air class MoE (~60 GB+). Do not list them as available.

**Llama 3.2 3B — the owner's current model — must be deprioritized in the UI.**
It cannot sustain agentic tool loops. Keep it as a "fast chat only" entry with
an explicit capability warning. This is the single biggest cause of the current
system feeling useless and the user should be told so plainly in the UI.

### 5.4 Model switching

- A **model dropdown in the chat header**, always visible, showing load state,
  VRAM use, and tok/s.
- Switching mid-conversation MUST work and MUST preserve history.
- **Per-conversation model memory** — reopening a conversation restores its
  model.
- **Role-based auto-routing** (default on, overridable): coding tasks →
  coding model; research → reasoning model; screen tasks → VL model; quick
  chat → small fast model. Route by conversation mode, not by guessing from
  message text.
- Swaps must be visibly progress-tracked. A 19 GB model load takes real time;
  show it.

---

## 6. Agent Loop

Replace the passthrough chat with a real tool-calling agent.

### 6.1 Requirements

- OpenAI-style function calling against `llama-server`'s `/v1/chat/completions`.
- **Fallback parser for models with weak native tool support** — many local
  models emit tool calls as XML/JSON in prose. Implement a tolerant extractor
  and constrain output with **GBNF grammars** where the model supports it.
  Assume tool calls will be malformed sometimes; never crash on it, re-prompt
  with the parse error.
- Streaming tokens to the UI, with visible tool-call cards (name, args,
  result, duration, error state) — extend the existing `ChatMessage` tool
  fields in `src/shared/types.ts`.
- **Interruptible.** A stop button that actually kills the in-flight generation
  and any running tool subprocess.
- **Loop control:** max iterations, wall-clock budget, and no-progress
  detection (same tool + same args twice in a row → intervene). Small models
  loop; design for it.
- **Context management.** Even with 256K native context, KV cache on 16 GB
  limits practical context. Implement: token counting, sliding window with
  pinned system prompt, automatic summarization of old turns, and tool-result
  truncation with an expandable full result stored out of context.
- **Sub-agents.** A spawn mechanism where a sub-agent gets its own context and
  returns only a summary. Essential for deep research (§8) and for keeping the
  main context clean.

### 6.2 Prompt/harness quality

Local models are far more sensitive to harness quality than frontier models.
Budget real effort here:
- Keep the system prompt tight; verbose prompts degrade small models.
- Few-shot the tool-call format for models with weak tool training.
- Re-inject the current task goal every N turns to fight drift.
- Make tool errors instructive ("path does not exist; did you mean X?") — the
  error text is the model's only feedback channel.

---

## 7. Permission System

The owner explicitly asked for this and it is the safety backbone of the whole
product:

> "each conversation has a choice dropdown which allows you to choose how many
> permissions the agent/local model has"

### 7.1 Requirements

- A **permission tier dropdown in the conversation header**, next to the model
  picker. Settable per conversation, changeable mid-conversation, persisted
  with the conversation, and clearly visible at all times (color-coded).
- **Every tool call passes through one gate function.** No tool may bypass it.
  This is the single most important invariant in the codebase — enforce it by
  making the tool registry the only path to execution, and unit-test that no
  tool can be invoked without a permission decision.

### 7.2 Suggested tiers

| Tier | Can do | Cannot do |
|---|---|---|
| **Read-only** | Read files in workspace, search web, read pages | Any write, any command, any input injection |
| **Workspace** | Read/write inside the chosen project folder, run allowlisted commands (build/test/lint), git read | Write outside workspace, arbitrary shell, network mutations |
| **Developer** | Everything above + arbitrary shell in workspace, git write, package installs, browser interaction | Write outside workspace, desktop input control |
| **Computer** | Everything above + full filesystem, mouse/keyboard control, any app | — |
| **Custom** | Per-capability toggles | — |

Each tier defines defaults per capability: `allow` / `ask` / `deny`.

### 7.3 Additional controls

- **Per-call approval prompts** for anything set to `ask`, showing the exact
  command or diff. Options: Allow once / Allow for this conversation / Always
  allow / Deny.
- **A hard-coded deny list that no tier can override**, e.g. writes to
  `C:\Windows`, `System32`, registry hives, credential stores, and destructive
  patterns (`format`, `rd /s` on drive roots, disk tools). Refuse and explain.
- **Emergency stop:** a global hotkey that immediately kills all agent
  activity, especially desktop control. Ship this *with* the computer-use
  feature, not after.
- **Audit log** of every permission decision and tool execution, viewable in
  the app, reusing `src/main/logger.ts`.

---

## 8. Tools

### 8.1 Files & workspace
`read_file` (with line ranges), `write_file`, `edit_file` (exact string
replace — the reliable primitive for local models), `list_dir`, `glob`,
`grep` (bundle ripgrep), `create_dir`, `move`, `delete` (to Recycle Bin, never
hard-delete).
All paths resolved against the workspace root and validated against escape
(`..`, symlinks, UNC, alternate drive letters).

### 8.2 Shell
Spawn PowerShell/cmd with streaming stdout/stderr into the UI, timeouts, cwd
pinned to the workspace, and cancellation. Never `shell: true` with
interpolated model output — pass argv arrays.

### 8.3 Browser
Bundle **Playwright + Chromium** (the app already targets Electron, so Chromium
DLL overlap is manageable; measure installer impact).
Tools: `navigate`, `read_page` (Readability-style extraction to clean
markdown), `screenshot`, `click`, `type`, `scroll`, `wait_for`,
`extract_links`, `pdf_extract`.
Run headful-but-hidden by default so sites that block headless still work; give
the user a "show browser" toggle to watch it.

### 8.4 Web search — keyless by design
The owner chose **no API keys** for search. Implement a provider chain:

1. **Direct engine scraping** (default, zero setup): DuckDuckGo HTML endpoint
   and Bing HTML, parsed server-side. Rotate user agents, respect rate limits,
   back off on 429.
2. **SearXNG** (opt-in, best quality): ship a bundled Windows binary or a
   one-click Docker setup. Aggregates 20+ engines, unlimited, fully private.
   Auto-start and supervise it like any other child process.
3. **Academic + code sources as first-class tools**, not scraped: arXiv API,
   Semantic Scholar API, PubMed E-utilities, Crossref, GitHub search API,
   Hacker News Algolia API, Stack Exchange API. All keyless or generous
   free tier. These are what make research output actually credible.
4. **Optional API keys** (Brave/Tavily) behind a settings field, stored with
   the existing `safeStorage` encryption. Off by default.

Providers register behind one interface so the chain can fail over silently.

### 8.5 Computer use
The owner selected all three of browser automation, files+shell, and full
desktop control. Sequence them: browser → files/shell → desktop.

For desktop control: screen capture, multi-monitor awareness, mouse move/click/
drag, keyboard input, window enumeration and focus (Win32 via a native addon or
`nut.js`).
**Always pair pixel-grounding with structure**: use OmniParser or the Windows
UI Automation tree to get element boxes, and use the VL model to choose among
them. Pure "predict pixel coordinates" is fragile at these model sizes.
Gate the whole capability behind the `Computer` tier plus a first-use
confirmation dialog, and require the emergency stop hotkey to be registered
before any input is synthesized.

---

## 9. Deep Research Pipeline

Not "search once and summarize." Implement a real multi-stage pipeline with
sub-agents:

1. **Clarify** — if the query is ambiguous, ask up to 2 focused questions.
2. **Plan** — decompose into 3–8 sub-questions; show the plan in the UI and let
   the user edit it before execution.
3. **Gather** — parallel sub-agents, one per sub-question, each running
   search → fetch → extract → note-take. Each returns structured notes with
   source URLs, not prose.
4. **Store** — chunk and embed every fetched source into SQLite (use
   `sqlite-vec` or similar) so the corpus is queryable and reusable across
   sessions.
5. **Rerank & synthesize** — retrieve top-k against the original question,
   rerank with the reranker model, and write the report with **inline
   citations linking to the exact source URL**.
6. **Verify** — a critic pass that checks every claim maps to a retrieved
   source and flags unsupported statements. This is what separates real deep
   research from confident hallucination, and it matters *more* with local
   models, not less.
7. **Deliver** — markdown report with a source table; export via the existing
   `src/main/export.ts` to markdown/PDF.

Show live progress: which sub-question, which source, how many gathered.
Research runs take minutes — the UI must make that legible rather than
looking hung.

---

## 10. Coding Agent

Owner selected: point-at-a-folder, in-app terminal view, and git-aware
workflow. (They also chose "Something else" without specifying — **ask them
what that was before finalizing Phase 3.**)

- **Workspace picker** — choose a folder; app indexes it (tree, languages,
  entry points, README, package manifests) and builds a retrieval index.
- **Diff-first editing** — every file write is shown as a syntax-highlighted
  diff and requires approval at `ask` tiers. Approve-all per conversation is
  fine; silent writes are not.
- **Embedded terminal** — real PTY (`node-pty` + `xterm.js`), showing agent
  commands as they run, with the user able to type in the same shell.
- **Git integration** — status, branch, stage, diff, commit with generated
  messages, and an auto-checkpoint commit before any agent edit session so
  every change is trivially revertible. This is the single best safety feature
  for a coding agent and should not be optional.
- **Project memory** — a per-workspace `AGENTS.md`-style file the agent reads
  on load and can append learned conventions to.

---

## 11. Cloud Escalation Seam

Owner: "local-first, free cloud tiers OK." Build the seam now, use it sparingly.

- A provider abstraction where local llama.cpp is one implementation and
  OpenAI-compatible HTTP endpoints are another.
- Support free tiers (Google AI Studio, Groq, OpenRouter free models) as
  optional, key-gated, **off by default**.
- **Escalation must be explicit and visible.** When a task is escalated, the UI
  must show which model handled it and that data left the machine. A
  per-conversation "never leave this machine" lock MUST be available and MUST
  be honored absolutely.
- Keys stored via `safeStorage`, same as the existing token handling.

---

## 12. Phasing

Ship each phase working. Do not start the next until the previous meets its
acceptance criteria.

### Phase 1 — Runtime foundation *(recommended start; confirm with owner)*
Engine provisioning, VRAM planner, model catalog + downloads, llama-swap
integration, model dropdown with hot swap, agent loop with tool calling,
permission system, files + shell tools.
**Accept when:** fresh install on the target machine → download a model →
load it → give it a multi-step file task → it completes it, with permission
prompts working and no terminal opened at any point. WSL and Ollama fully
removed from the codebase.

### Phase 2 — Research
Browser, search provider chain, academic sources, embeddings + vector store,
sub-agent orchestration, cited report generation, verification pass.
**Accept when:** a real research question produces a cited report with ≥10
distinct sources, every claim traceable, in under ~10 minutes.

### Phase 3 — Coding agent
Workspace, indexing, diffs, PTY terminal, git integration, checkpointing.
**Accept when:** it completes a real multi-file change in a real repository,
with reviewable diffs and a revertible checkpoint.

### Phase 4 — Computer use + voice
Screen capture, element grounding, input control, emergency stop; then STT/TTS,
wake word, overlay. Alternate backends (Ollama/LM Studio detection).

### Phase 5 — UI/UX
**Explicitly deferred by the owner.** Function first. Do not spend Phase 1–4
effort on visual polish beyond "legible and not confusing."

---

## 13. Non-Goals

- Visual/UI refinement (owner deferred it to a later phase).
- Cross-platform support. Windows only. Do not add abstraction for macOS/Linux.
- Multi-user, cloud sync, or accounts.
- Training or fine-tuning models.
- Preserving compatibility with the OpenClaw gateway protocol.

---

## 14. Engineering Standards

- TypeScript strict; `npm run typecheck` must pass.
- Keep `contextIsolation: true`, `nodeIntegration: false`. All privileged work
  in main, exposed through typed, narrowly-scoped IPC in `src/preload/`.
- Never interpolate model output into a shell string.
- Every child process must be supervised: health-checked, restart-with-backoff,
  and reliably killed on app quit (including on crash — orphaned
  `llama-server.exe` holding 16 GB of VRAM is a serious bug).
- Log every subsystem through the existing logger with scopes.
- Tests: unit-test the VRAM planner, the permission gate, the tool-call parser,
  and path escape validation. These four are where correctness actually bites.
- Small, reviewable commits on branch `claude/openclaw-local-ai-agent-frmzy3`.
  Do not open a PR unless asked.

---

## 15. Questions to Resolve With the Owner Before Phase 1

1. **Phase order** — is Phase 1 (runtime foundation) the right start, or would
   they rather see research or coding first? Runtime is a hard prerequisite for
   both, so the recommendation is to start there regardless.
2. **The unspecified "Something else"** in the coding-workflow question — what
   did they mean?
3. **Installer size** — is a ~2 GB installer acceptable for a fully bundled
   engine, or should the app ship small and download the engine on first run?
4. **SearXNG delivery** — is Docker acceptable on their machine, or must it be
   a bundled native binary?
5. **Voice** — was voice/always-on deliberately not selected, or just not a
   priority yet?
6. **Existing installs** — do they have Ollama models on disk already worth
   importing rather than re-downloading?
