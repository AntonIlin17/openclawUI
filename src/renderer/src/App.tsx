import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ChevronRight,
  CircleHelp,
  FolderOpen,
  Home,
  MessageSquare,
  Plus,
  Search,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import type {
  AppSettings,
  Attachment,
  ChatMessage,
  ConversationSummary,
  GatewayStatus,
  SendMessageInput,
} from "../../shared/types";
import { LocalModelPicker } from "./LocalModelPicker";
import { ChatView } from "./Conversation";
import { ConnectionPage } from "./ConnectionPage";
import { HomePage, FilesPage, InfoDialog } from "./WorkspacePages";
import "./styles.css";

type Page = "home" | "chat" | "files" | "connection";
const ready = (s: GatewayStatus) =>
  ["connected", "idle", "running", "streaming"].includes(s.state);
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function App() {
  const [page, setPage] = useState<Page>("home");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [status, setStatus] = useState<GatewayStatus>({
    state: "connecting",
    detail: "Checking your connection",
  });
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [draftId, setDraftId] = useState(0);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<"plan" | "help" | null>(null);
  const activeRef = useRef(activeKey);
  const historyRequest = useRef(0);
  const agentRef = useRef("main");
  activeRef.current = activeKey;
  const connected = ready(status);

  async function loadConversations() {
    setLoadingHistory(true);
    try {
      setConversations(
        await window.openclaw.listConversations(agentRef.current),
      );
    } catch (e) {
      setError(`Couldn't load conversations. ${errorText(e)}`);
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => {
    if (!window.openclaw) return;
    void Promise.all([
      window.openclaw.getSettings(),
      window.openclaw.getStatus(),
    ])
      .then(([s, next]) => {
        setSettings(s);
        setStatus(next);
      })
      .catch((e) => setError(errorText(e)));
    const off = [
      window.openclaw.on<GatewayStatus>("gateway:status", setStatus),
      window.openclaw.on<{ sessionKey: string; messages: ChatMessage[] }>(
        "conversation:messages",
        (payload) => {
          if (payload.sessionKey === activeRef.current)
            setMessages(payload.messages);
        },
      ),
      window.openclaw.on<AppSettings>("app:settings", (next) => {
        setSettings(next);
        setPage("connection");
      }),
      window.openclaw.on<void>("tray:new-conversation", () => newChat()),
      window.openclaw.on<void>("tray:history", () => setPage("chat")),
    ];
    return () => off.forEach((fn) => fn());
  }, []);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    void window.openclaw
      .listAgents()
      .then((agents) => {
        if (!cancelled) {
          agentRef.current = agents[0]?.id ?? "main";
          void loadConversations();
        }
      })
      .catch((e) => {
        if (!cancelled)
          setError(
            `Connected, but assistant details could not load. ${errorText(e)}`,
          );
      });
    return () => {
      cancelled = true;
    };
  }, [connected]);

  function newChat(text = "", files: Attachment[] = []) {
    historyRequest.current++;
    activeRef.current = null;
    setActiveKey(null);
    setMessages([]);
    setDraft(text);
    setAttachments(files);
    setDraftId((n) => n + 1);
    setPage("chat");
    setError(null);
  }

  async function openConversation(item: ConversationSummary) {
    const request = ++historyRequest.current;
    activeRef.current = item.key;
    setActiveKey(item.key);
    setMessages([]);
    setDraft("");
    setAttachments([]);
    setDraftId((n) => n + 1);
    setPage("chat");
    setError(null);
    try {
      await window.openclaw.loadHistory(item.key, 200);
    } catch (e) {
      if (request === historyRequest.current)
        setError(`Couldn't open this conversation. ${errorText(e)}`);
    }
  }

  async function send(input: SendMessageInput) {
    let key = activeRef.current;
    if (!key) {
      setCreating(true);
      try {
        const item = await window.openclaw.createConversation(agentRef.current);
        key = item.key;
        activeRef.current = key;
        setActiveKey(key);
        setConversations((all) => [
          item,
          ...all.filter((c) => c.key !== item.key),
        ]);
      } finally {
        setCreating(false);
      }
    }
    await window.openclaw.sendMessage({ ...input, sessionKey: key });
    void loadConversations();
  }

  async function attach() {
    try {
      const files = await window.openclaw.chooseAttachmentFiles();
      if (files.length) newChat("Help me understand these files.", files);
    } catch (e) {
      setError(errorText(e));
    }
  }

  const active = conversations.find((c) => c.key === activeKey);
  const activeRun =
    status.activeRun?.sessionKey === activeKey ? status.activeRun : undefined;
  const filtered = conversations.filter((c) =>
    `${c.title} ${c.preview ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const nav = [
    { id: "home", label: "Overview", icon: Home },
    { id: "chat", label: "Conversations", icon: MessageSquare },
    { id: "files", label: "Files & folders", icon: FolderOpen },
  ] as const;

  if (!window.openclaw)
    return (
      <div className="browser-notice">
        <Sparkles size={40} />
        <h1>OpenClaw Desktop</h1>
        <p>
          Open the desktop app to connect to your local assistant. This browser
          window cannot access the desktop connection.
        </p>
      </div>
    );

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Main navigation">
        <button
          className="brand"
          onClick={() => setPage("home")}
          aria-label="OpenClaw overview"
        >
          <span className="brand-symbol">
            <Sparkles size={21} />
          </span>
          <span>
            <strong>
              openclaw<span className="brand-dot">.</span>
            </strong>
            <small>Your local workspace</small>
          </span>
        </button>
        <button className="primary-button new-chat" onClick={() => newChat()}>
          <Plus size={17} /> New conversation{" "}
          <span className="key-hint" aria-hidden="true">
            ↗
          </span>
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? "selected" : ""}`}
              onClick={() => setPage(item.id)}
              aria-current={page === item.id ? "page" : undefined}
            >
              <item.icon size={18} />
              {item.label}
              {item.id === "chat" && conversations.length > 0 ? (
                <span className="nav-count">{conversations.length}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-recent">
          <div className="nav-label">RECENT CONVERSATIONS</div>
          {conversations.slice(0, 4).map((c) => (
            <button
              className={`recent-item ${c.key === activeKey && page === "chat" ? "current" : ""}`}
              key={c.key}
              onClick={() => void openConversation(c)}
            >
              <MessageSquare size={14} />
              <span>{c.title}</span>
            </button>
          ))}
          {!conversations.length ? (
            <p className="sidebar-empty">
              Your conversations will appear here.
            </p>
          ) : null}
        </div>
        <div className="sidebar-bottom">
          <button
            className="connection-tile"
            onClick={() => setPage("connection")}
          >
            <span className={`connection-dot ${connected ? "online" : ""}`} />
            <span>
              <strong>
                {connected
                  ? "Assistant connected"
                  : "Assistant needs attention"}
              </strong>
              <small>
                {connected
                  ? "Running on your computer"
                  : "Set up your connection"}
              </small>
            </span>
            <ChevronRight size={16} />
          </button>
          <button
            className={`nav-item ${page === "connection" ? "selected" : ""}`}
            onClick={() => setPage("connection")}
          >
            <Settings2 size={18} /> Connection & settings
          </button>
          <button className="nav-item" onClick={() => setDialog("help")}>
            <CircleHelp size={18} /> How it works
          </button>
          <div className="local-note">
            <span className="connection-dot online" /> Local AI. Your own
            workspace.
          </div>
        </div>
      </aside>
      <main
        className={`workspace ${page === "chat" ? "conversation-workspace" : ""}`}
      >
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <strong>
              {page === "connection"
                ? "Connection & settings"
                : nav.find((n) => n.id === page)?.label}
            </strong>
          </div>
          <button
            className={`status-badge ${connected ? "online" : ""}`}
            onClick={() => setPage("connection")}
          >
            <span className="connection-dot" />
            {connected
              ? "Local assistant ready"
              : status.state === "connecting"
                ? "Connecting assistant"
                : "Connection needed"}
            <ChevronRight size={12} />
          </button>
        </header>
        {error ? (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss error">
              <X size={16} />
            </button>
          </div>
        ) : null}
        {page === "home" ? (
          <HomePage
            connected={connected}
            onConnect={() => setPage("connection")}
            onChat={newChat}
            onFiles={() => setPage("files")}
            onAttach={() => void attach()}
            onPlan={() => setDialog("plan")}
            onHelp={() => setDialog("help")}
          />
        ) : null}
        {page === "chat" ? (
          <div className="chat-layout">
            <section
              className="history-panel"
              aria-label="Conversation history"
            >
              <div className="section-heading">
                <h2>Conversations</h2>
                <button
                  className="icon-button"
                  title="New conversation"
                  onClick={() => newChat()}
                >
                  <Plus size={18} />
                </button>
              </div>
              <label className="search-field">
                <Search size={15} />
                <input
                  aria-label="Search conversations"
                  placeholder="Search conversations"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <div className="history-list">
                {filtered.map((c) => (
                  <HistoryItem
                    key={c.key}
                    item={c}
                    active={c.key === activeKey}
                    onOpen={() => void openConversation(c)}
                    onRename={async (title) => {
                      await window.openclaw.renameConversation(c.key, title);
                      await loadConversations();
                    }}
                    onError={(e) => setError(errorText(e))}
                  />
                ))}
                {!filtered.length ? (
                  <div className="history-empty">
                    <MessageSquare size={24} />
                    <strong>
                      {search ? "No matching conversations" : "A fresh start"}
                    </strong>
                    <p>
                      {connected
                        ? "Start a conversation. It will be saved here."
                        : "Connect your assistant to load saved conversations."}
                    </p>
                  </div>
                ) : null}
              </div>
              <button
                className="text-button history-refresh"
                disabled={!connected || loadingHistory}
                onClick={() => void loadConversations()}
              >
                {loadingHistory ? "Loading conversations…" : "Refresh history"}
              </button>
            </section>
            <section className="chat-pane">
              <div className="conversation-heading">
                <div>
                  <span className="page-eyebrow">YOUR ASSISTANT</span>
                  <h2>{active?.title ?? "New conversation"}</h2>
                </div>
                {active ? (
                  <div className="export-actions">
                    {(["markdown", "pdf"] as const).map((format) => (
                      <button
                        key={format}
                        className="text-button"
                        onClick={() =>
                          void window.openclaw
                            .exportConversation({
                              sessionTitle: active.title,
                              messages,
                              format,
                            })
                            .catch((e) => setError(errorText(e)))
                        }
                      >
                        <ArrowDownToLine size={15} />
                        {format === "pdf" ? "PDF" : "Markdown"}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <LocalModelPicker
                compact
                sessionKey={activeKey ?? undefined}
                activeModel={
                  active?.model
                    ? active.model.includes("/")
                      ? active.model
                      : `${active.provider ?? "ollama"}/${active.model}`
                    : undefined
                }
                disabled={Boolean(status.activeRun)}
                onApplied={(model) => {
                  setSettings((current) =>
                    current ? { ...current, preferredModel: model } : current,
                  );
                  void loadConversations();
                }}
              />
              {!connected ? (
                <div className="chat-connection-note">
                  <span>Your message will stay here while you connect.</span>
                  <button onClick={() => setPage("connection")}>
                    Connect assistant <ChevronRight size={14} />
                  </button>
                </div>
              ) : null}
              <ChatView
                key={draftId}
                sessionKey={activeKey ?? ""}
                settings={settings}
                messages={messages}
                connected={connected && !creating}
                initialText={draft}
                initialAttachments={attachments}
                onDraftChange={(text, files) => {
                  setDraft(text);
                  setAttachments(files);
                }}
                activeRun={activeRun}
                onSent={send}
                onCancelRun={() => {
                  if (activeRun)
                    void window.openclaw
                      .cancelRun({
                        sessionKey: activeRun.sessionKey,
                        runId: activeRun.runId,
                      })
                      .catch((e) => setError(errorText(e)));
                }}
              />
            </section>
          </div>
        ) : null}
        {page === "files" ? (
          <FilesPage
            settings={settings}
            onAttach={() => void attach()}
            onManage={() => setPage("connection")}
            onChat={newChat}
          />
        ) : null}
        {page === "connection" ? (
          <ConnectionPage
            settings={settings}
            status={status}
            onSaved={(next) => {
              setSettings(next);
              setError(null);
            }}
            onError={setError}
            onGoChat={() => setPage("chat")}
          />
        ) : null}
      </main>
      {dialog ? (
        <InfoDialog
          kind={dialog}
          onClose={() => setDialog(null)}
          onConnect={() => {
            setDialog(null);
            setPage("connection");
          }}
        />
      ) : null}
    </div>
  );
}

function HistoryItem({
  item,
  active,
  onOpen,
  onRename,
  onError,
}: {
  item: ConversationSummary;
  active: boolean;
  onOpen: () => void;
  onRename: (title: string) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [saving, setSaving] = useState(false);
  return (
    <div className={`history-item ${active ? "active" : ""}`}>
      {editing ? (
        <form
          className="rename-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!title.trim() || saving) return;
            setSaving(true);
            void onRename(title.trim())
              .then(() => setEditing(false))
              .catch(onError)
              .finally(() => setSaving(false));
          }}
        >
          <input
            autoFocus
            aria-label="Conversation name"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setEditing(false);
            }}
          />
          <div>
            <button type="submit" disabled={saving || !title.trim()}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <button onClick={onOpen}>
            <strong>{item.title}</strong>
            <span>{item.preview || "Open conversation"}</span>
          </button>
          <button
            className="history-rename"
            title="Rename conversation"
            aria-label={`Rename ${item.title}`}
            onClick={() => {
              setTitle(item.title);
              setEditing(true);
            }}
          >
            …
          </button>
        </>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
