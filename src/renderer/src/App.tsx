import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bot,
  Check,
  ChevronDown,
  Copy,
  FilePlus,
  Mic,
  MoreHorizontal,
  PanelLeft,
  Paperclip,
  Pencil,
  Play,
  Plus,
  Search,
  Settings,
  Square,
  Trash2,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import hljs from "highlight.js";
import mermaid from "mermaid";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";
import "./styles.css";
import type {
  AgentSummary,
  AppSettings,
  Attachment,
  ChatMessage,
  ConversationSummary,
  GatewayStatus,
  ModelChoice,
  ThinkingLevel,
} from "../../shared/types";

const blankStatus: GatewayStatus = { state: "connecting", detail: "Starting" };

function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [status, setStatus] = useState<GatewayStatus>(blankStatus);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeAgent, setActiveAgent] = useState("main");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyFocused, setHistoryFocused] = useState(false);

  useEffect(() => {
    void boot();
    const offStatus = window.openclaw.on<GatewayStatus>("gateway:status", setStatus);
    const offMessages = window.openclaw.on<{ sessionKey: string; messages: ChatMessage[] }>("conversation:messages", (payload) => {
      if (payload.sessionKey === activeKeyRef.current) {
        setMessages(payload.messages);
      }
      void refreshConversations(activeAgentRef.current);
    });
    const offSettings = window.openclaw.on<AppSettings>("app:settings", (next) => {
      setSettings(next);
      setSettingsOpen(true);
    });
    const offNew = window.openclaw.on<void>("tray:new-conversation", () => void createConversation(activeAgentRef.current));
    const offHistory = window.openclaw.on<void>("tray:history", () => {
      setHistoryFocused(true);
      window.setTimeout(() => setHistoryFocused(false), 1400);
    });
    return () => {
      offStatus();
      offMessages();
      offSettings();
      offNew();
      offHistory();
    };
  }, []);

  const activeKeyRef = useRef(activeKey);
  const activeAgentRef = useRef(activeAgent);
  useEffect(() => {
    activeKeyRef.current = activeKey;
  }, [activeKey]);
  useEffect(() => {
    activeAgentRef.current = activeAgent;
  }, [activeAgent]);

  async function boot() {
    const [nextSettings, nextStatus] = await Promise.all([window.openclaw.getSettings(), window.openclaw.getStatus()]);
    setSettings(nextSettings);
    setStatus(nextStatus);
    const [nextAgents, nextModels] = await Promise.all([
      window.openclaw.listAgents().catch(() => [{ id: "main", name: "Main" }]),
      window.openclaw.listModels().catch(() => []),
    ]);
    setAgents(nextAgents.length ? nextAgents : [{ id: "main", name: "Main" }]);
    setModels(nextModels);
    const defaultAgent = nextAgents[0]?.id ?? "main";
    setActiveAgent(defaultAgent);
    await refreshConversations(defaultAgent, true);
  }

  async function refreshConversations(agentId: string, openFirst = false) {
    const list = await window.openclaw.listConversations(agentId).catch(() => []);
    setConversations(list);
    if (openFirst && list[0]) {
      await openConversation(list[0].key);
    }
  }

  async function createConversation(agentId: string) {
    const created = await window.openclaw.createConversation(agentId);
    setConversations((items) => [created, ...items.filter((item) => item.key !== created.key)]);
    await openConversation(created.key);
  }

  async function openConversation(key: string) {
    setActiveKey(key);
    setMessages([]);
    await window.openclaw.loadHistory(key, 200).catch(() => undefined);
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return conversations;
    }
    return conversations.filter((item) => `${item.title} ${item.preview ?? ""}`.toLowerCase().includes(term));
  }, [conversations, search]);

  const activeConversation = conversations.find((item) => item.key === activeKey);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${historyFocused ? "pulse" : ""}`}>
        <div className="brand">
          <div className="mark">C</div>
          <div>
            <strong>OpenClaw</strong>
            <span>Desktop</span>
          </div>
        </div>
        <button className="new-button" onClick={() => void createConversation(activeAgent)}>
          <Plus size={16} /> New conversation
        </button>
        <label className="search">
          <Search size={15} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search history" />
        </label>
        <div className="agent-row">
          <Bot size={15} />
          <select
            value={activeAgent}
            onChange={(event) => {
              setActiveAgent(event.target.value);
              void refreshConversations(event.target.value, true);
            }}
          >
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name ?? agent.id}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </div>
        <div className="conversation-list">
          {filtered.map((item) => (
            <ConversationItem
              key={item.key}
              item={item}
              active={item.key === activeKey}
              onOpen={() => void openConversation(item.key)}
              onRename={(title) => {
                void window.openclaw.renameConversation(item.key, title).then(() => refreshConversations(activeAgent));
              }}
              onDelete={() => {
                void window.openclaw.deleteConversation(item.key).then(() => {
                  setConversations((items) => items.filter((entry) => entry.key !== item.key));
                  if (activeKey === item.key) {
                    setActiveKey(null);
                    setMessages([]);
                  }
                });
              }}
            />
          ))}
        </div>
      </aside>
      <main className="chat-pane">
        <Header
          status={status}
          settings={settings}
          models={models}
          conversation={activeConversation}
          onSettings={() => setSettingsOpen(true)}
          onExport={(format) => {
            if (activeConversation) {
              void window.openclaw.exportConversation({ sessionTitle: activeConversation.title, messages, format });
            }
          }}
        />
        {activeKey ? (
          <ChatView
            messages={messages}
            sessionKey={activeKey}
            settings={settings}
            onSent={(input) => {
              void window.openclaw.sendMessage(input);
            }}
          />
        ) : (
          <EmptyState onStart={() => void createConversation(activeAgent)} />
        )}
      </main>
      {settings && settingsOpen ? (
        <SettingsModal
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={(next) => {
            void window.openclaw.saveSettings(next).then((saved) => {
              setSettings(saved);
              setSettingsOpen(false);
            });
          }}
        />
      ) : null}
    </div>
  );
}

function ConversationItem(props: {
  item: ConversationSummary;
  active: boolean;
  onOpen: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(props.item.title);
  return (
    <div className={`conversation ${props.active ? "active" : ""}`} onClick={props.onOpen}>
      {editing ? (
        <input
          className="rename"
          value={title}
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            setEditing(false);
            props.onRename(title);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setEditing(false);
              props.onRename(title);
            }
          }}
        />
      ) : (
        <div className="conversation-text">
          <strong>{props.item.title}</strong>
          <span>{props.item.preview || props.item.model || "No messages yet"}</span>
        </div>
      )}
      <div className="row-actions">
        <button title="Rename" onClick={(event) => { event.stopPropagation(); setEditing(true); }}><Pencil size={14} /></button>
        <button title="Delete" onClick={(event) => { event.stopPropagation(); props.onDelete(); }}><Trash2 size={14} /></button>
      </div>
    </div>
  );
}

function Header(props: {
  status: GatewayStatus;
  settings: AppSettings | null;
  models: ModelChoice[];
  conversation?: ConversationSummary;
  onSettings: () => void;
  onExport: (format: "markdown" | "pdf") => void;
}) {
  return (
    <header className="header">
      <div className="header-title">
        <PanelLeft size={17} />
        <div>
          <strong>{props.conversation?.title ?? "OpenClaw Desktop"}</strong>
          <span>{props.status.detail ?? props.status.state}</span>
        </div>
      </div>
      <div className="power-controls">
        <select value={props.settings?.preferredModel ?? ""} onChange={() => undefined}>
          <option value="">{props.conversation?.model ?? "Default model"}</option>
          {props.models.map((model) => (
            <option key={model.id} value={model.id}>{model.provider}/{model.name}</option>
          ))}
        </select>
        <span className={`status-pill ${props.status.state}`}>{props.status.state}</span>
        <span className="tokens">{props.conversation?.totalTokens ?? props.status.totalTokens ?? 0} tokens</span>
        <button title="Export Markdown" onClick={() => props.onExport("markdown")}><FilePlus size={16} /></button>
        <button title="Export PDF" onClick={() => props.onExport("pdf")}><MoreHorizontal size={16} /></button>
        <button title="Settings" onClick={props.onSettings}><Settings size={16} /></button>
      </div>
    </header>
  );
}

function ChatView(props: {
  messages: ChatMessage[];
  sessionKey: string;
  settings: AppSettings | null;
  onSent: (input: { sessionKey: string; message: string; thinking: ThinkingLevel; attachments: Attachment[] }) => void;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [recording, setRecording] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = listRef.current;
    if (!node) {
      return;
    }
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 180;
    if (nearBottom) {
      node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    }
  }, [props.messages]);

  function send() {
    if (!text.trim() && attachments.length === 0) {
      return;
    }
    props.onSent({ sessionKey: props.sessionKey, message: text.trim(), thinking: props.settings?.thinking ?? "brief", attachments });
    setText("");
    setAttachments([]);
  }

  async function attachFiles(paths?: string[]) {
    if (!paths?.length) {
      return;
    }
    const resolved = await window.openclaw.resolveDroppedFiles(paths);
    setAttachments((items) => [...items, ...resolved]);
  }

  return (
    <>
      <div
        className="messages"
        ref={listRef}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const paths = [...event.dataTransfer.files].map((file) => file.path).filter(Boolean);
          void attachFiles(paths);
        }}
      >
        {props.messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
      </div>
      <div className="composer-wrap">
        {attachments.length ? (
          <div className="attachments">
            {attachments.map((item) => (
              <span className="chip" key={item.id}>{item.name}<button onClick={() => setAttachments((all) => all.filter((entry) => entry.id !== item.id))}><X size={12} /></button></span>
            ))}
          </div>
        ) : null}
        <div className="composer">
          <button title="Attach" onClick={() => void window.openclaw.chooseAttachmentFiles().then((files) => setAttachments((items) => [...items, ...files]))}><Paperclip size={18} /></button>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            onPaste={(event) => {
              const image = [...event.clipboardData.files].find((file) => file.type.startsWith("image/"));
              if (image) {
                const reader = new FileReader();
                reader.onload = () => setAttachments((items) => [...items, { id: crypto.randomUUID(), name: image.name || "pasted-image.png", type: image.type, dataUrl: String(reader.result) }]);
                reader.readAsDataURL(image);
              }
            }}
            placeholder="Message OpenClaw..."
          />
          <button className={recording ? "recording" : ""} title="Voice input" onClick={() => startVoice(setText, setRecording)}><Mic size={18} /></button>
          <button className="send" title="Send" onClick={send}><Play size={18} /></button>
        </div>
      </div>
    </>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "tool") {
    return <ToolCard message={message} />;
  }
  return (
    <article className={`message ${message.role}`}>
      <div className="avatar">{message.role === "user" ? "You" : "OC"}</div>
      <div className="message-body">
        <button className="copy-message" title="Copy" onClick={() => void navigator.clipboard.writeText(message.content)}><Copy size={14} /></button>
        <Markdown content={message.content} />
        {message.attachments?.length ? (
          <div className="attachments sent">{message.attachments.map((item) => <span className="chip" key={item.id}>{item.name}</span>)}</div>
        ) : null}
      </div>
    </article>
  );
}

function ToolCard({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tool-card">
      <button className="tool-summary" onClick={() => setOpen(!open)}>
        <span>{message.toolPartial ? <Square size={13} /> : <Check size={13} />}</span>
        <strong>{message.toolName ?? "tool"}</strong>
        <span>{message.toolPartial ? "running" : message.toolError ? "error" : "complete"}</span>
      </button>
      {open ? (
        <div className="tool-detail">
          <pre>{JSON.stringify({ args: message.toolArgs, result: message.toolResult }, null, 2)}</pre>
        </div>
      ) : null}
    </div>
  );
}

function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        code(props) {
          const { className, children } = props;
          const match = /language-(\w+)/.exec(className || "");
          const lang = match?.[1];
          const raw = String(children).replace(/\n$/, "");
          if (lang === "mermaid") {
            return <Mermaid code={raw} />;
          }
          if (lang === "chart") {
            return <ChartBlock code={raw} />;
          }
          if (lang) {
            const highlighted = hljs.getLanguage(lang) ? hljs.highlight(raw, { language: lang }).value : hljs.highlightAuto(raw).value;
            return (
              <div className="code-block">
                <button title="Copy code" onClick={() => void navigator.clipboard.writeText(raw)}><Copy size={14} /></button>
                <pre><code dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>
              </div>
            );
          }
          return <code>{children}</code>;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function Mermaid({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    mermaid.initialize({ startOnLoad: false, theme: "dark" });
    void mermaid.render(`m-${crypto.randomUUID()}`, code).then((result) => setSvg(result.svg)).catch(() => setSvg(""));
  }, [code]);
  return svg ? <div className="diagram" dangerouslySetInnerHTML={{ __html: svg }} /> : <pre>{code}</pre>;
}

function ChartBlock({ code }: { code: string }) {
  return <pre className="chart-block">{code}</pre>;
}

function EmptyState({ onStart }: { onStart: () => void }) {
  return (
    <div className="empty">
      <div className="empty-mark">C</div>
      <h1>OpenClaw Desktop</h1>
      <p>Pick up a session or start a fresh conversation with your local Gateway.</p>
      <button className="new-button" onClick={onStart}><Plus size={16} /> New conversation</button>
    </div>
  );
}

function SettingsModal(props: { settings: AppSettings; onClose: () => void; onSave: (settings: AppSettings) => void }) {
  const [draft, setDraft] = useState(props.settings);
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header"><strong>Settings</strong><button onClick={props.onClose}><X size={16} /></button></div>
        <div className="settings-grid">
          <label>Gateway URL<input value={draft.gatewayUrl} onChange={(e) => setDraft({ ...draft, gatewayUrl: e.target.value })} /></label>
          <label>WSL distro<input value={draft.wslDistro} onChange={(e) => setDraft({ ...draft, wslDistro: e.target.value })} /></label>
          <label>Gateway command<input value={draft.gatewayCommand} onChange={(e) => setDraft({ ...draft, gatewayCommand: e.target.value })} /></label>
          <label>Auth<select value={draft.authMode} onChange={(e) => setDraft({ ...draft, authMode: e.target.value as AppSettings["authMode"] })}><option value="auto">Auto</option><option value="none">None</option><option value="token">Token</option><option value="password">Password</option></select></label>
          <label>Token<input type="password" value={draft.token ?? ""} onChange={(e) => setDraft({ ...draft, token: e.target.value })} /></label>
          <label>Password<input type="password" value={draft.password ?? ""} onChange={(e) => setDraft({ ...draft, password: e.target.value })} /></label>
          <label>Thinking<select value={draft.thinking} onChange={(e) => setDraft({ ...draft, thinking: e.target.value as ThinkingLevel })}><option value="none">None</option><option value="brief">Brief</option><option value="detailed">Detailed</option></select></label>
          <label className="toggle"><input type="checkbox" checked={draft.autostart} onChange={(e) => setDraft({ ...draft, autostart: e.target.checked })} /> Launch on startup</label>
        </div>
        <div className="file-access">
          <strong>Windows file access</strong>
          {draft.fileAccessPaths.map((item) => (
            <span className="chip" key={item}>
              {item}
              <button
                title="Remove"
                onClick={() =>
                  setDraft({
                    ...draft,
                    fileAccessPaths: draft.fileAccessPaths.filter((pathItem) => pathItem !== item),
                  })
                }
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <button
            onClick={() =>
              void window.openclaw.chooseFileAccessPaths().then((paths) =>
                setDraft({
                  ...draft,
                  fileAccessPaths: [...new Set([...draft.fileAccessPaths, ...paths])],
                }),
              )
            }
          >
            Add folders
          </button>
          <button onClick={() => void window.openclaw.orientOpenClaw(draft.fileAccessPaths)}>Write OpenClaw guidance</button>
        </div>
        <div className="modal-actions">
          <button onClick={props.onClose}>Cancel</button>
          <button className="send" onClick={() => props.onSave(draft)}>Save</button>
        </div>
      </div>
    </div>
  );
}

function startVoice(setText: React.Dispatch<React.SetStateAction<string>>, setRecording: React.Dispatch<React.SetStateAction<boolean>>) {
  const Speech = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!Speech) {
    return;
  }
  const recognition = new Speech();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.onstart = () => setRecording(true);
  recognition.onend = () => setRecording(false);
  recognition.onresult = (event: { results: ArrayLike<SpeechRecognitionResult> }) => {
    const transcript = Array.from(event.results)
      .map((result) => (result as SpeechRecognitionResult)[0]?.transcript ?? "")
      .join("");
    setText((previous) => `${previous}${previous && transcript ? " " : ""}${transcript}`);
  };
  recognition.start();
}

try {
  createRoot(document.getElementById("root")!).render(<App />);
} catch (error) {
  const root = document.getElementById("root");
  if (root) {
    root.innerHTML = `<div style="padding:32px;color:#f4efe7;background:#141414;font-family:Segoe UI,system-ui,sans-serif;min-height:100vh"><h1>OpenClaw Desktop</h1><p>Renderer startup failed.</p><pre style="white-space:pre-wrap">${String(error)}</pre></div>`;
  }
  throw error;
}
