import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUp,
  Bot,
  Check,
  CircleHelp,
  FileSearch,
  FolderOpen,
  Plus,
  Search,
  Sparkles,
  TrendingUp,
  Wifi,
  X,
} from "lucide-react";
import type { AppSettings } from "../../shared/types";

export function HomePage(p: {
  connected: boolean;
  onConnect: () => void;
  onChat: (text?: string) => void;
  onFiles: () => void;
  onAttach: () => void;
  onPlan: () => void;
  onHelp: () => void;
}) {
  const [text, setText] = useState("");
  return (
    <div className="page-scroll">
      <div className="overview page-content">
        <div className="page-eyebrow">
          <span className="tiny-line" /> YOUR LOCAL WORKSPACE{" "}
          <span className="today">
            {new Intl.DateTimeFormat(undefined, {
              month: "short",
              day: "numeric",
            }).format(new Date())}
          </span>
        </div>
        <h1>
          What would you like
          <br />
          to get done<span className="accent-text"> today?</span>
        </h1>
        <p className="page-lead">
          A little help with your files, your research, and everything in
          between.
        </p>
        <div className="home-composer">
          <label htmlFor="home-request" className="sr-only">
            What would you like help with?
          </label>
          <textarea
            id="home-request"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Describe what you’d like help with…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && text.trim()) {
                e.preventDefault();
                p.onChat(text);
              }
            }}
          />
          <div className="home-composer-footer">
            <button className="text-button" onClick={p.onAttach}>
              <Plus size={16} /> Attach a file
            </button>
            <span>Start with a simple request</span>
            <button
              className="round-button"
              aria-label="Open request in conversation"
              disabled={!text.trim()}
              onClick={() => p.onChat(text)}
            >
              <ArrowUp size={19} />
            </button>
          </div>
        </div>
        {!p.connected ? (
          <div className="setup-banner">
            <span className="setup-icon">
              <Wifi size={20} />
            </span>
            <div>
              <strong>First, let’s connect your assistant.</strong>
              <p>
                Ollama runs your AI model. OpenClaw gives it tools. We’ll help
                you connect them.
              </p>
            </div>
            <button className="secondary-button" onClick={p.onConnect}>
              Set up connection <ArrowRight size={15} />
            </button>
          </div>
        ) : (
          <div className="ready-note">
            <Check size={15} /> Your assistant is connected. Choose a starting
            point below.
          </div>
        )}
        <div className="section-heading">
          <h2>A place to start</h2>
          <span>Make the everyday a little easier</span>
        </div>
        <div className="starter-grid">
          <button className="starter-card" onClick={p.onFiles}>
            <span className="card-icon sage">
              <FileSearch size={23} />
            </span>
            <h3>Find it. Make sense of it.</h3>
            <p>
              Bring a file or folder into your conversation. Ask questions, find
              details, or plan a tidy-up.
            </p>
            <span className="card-link">
              Explore your files <ArrowRight size={16} />
            </span>
          </button>
          <button
            className="starter-card"
            onClick={() =>
              p.onChat(
                "Research this topic and give me a clear summary with links to your sources: ",
              )
            }
          >
            <span className="card-icon lavender">
              <Search size={23} />
            </span>
            <h3>Follow your curiosity.</h3>
            <p>
              Explore a topic with your assistant. Ask for a clear summary and
              sources you can check.
            </p>
            <span className="card-link">
              Start researching <ArrowRight size={16} />
            </span>
          </button>
        </div>
        <div className="upcoming-card">
          <span className="card-icon sand">
            <TrendingUp size={22} />
          </span>
          <div>
            <div className="upcoming-title">
              <h3>Stock data, on your schedule.</h3>
              <span className="planned-tag">READY WHEN YOU ARE</span>
            </div>
            <p>
              Your watchlist. A daily collection. A clearer picture. Save US
              stock and ETF history locally, then export it whenever you need.
            </p>
          </div>
          <button
            className="icon-button"
            aria-label="Open stock data collection"
            onClick={p.onPlan}
          >
            <ArrowRight size={20} />
          </button>
        </div>
        <footer className="overview-footer">
          <Bot size={16} />
          <span>Powered by your local model through OpenClaw</span>
          <button onClick={p.onHelp}>
            How it works <ArrowRight size={13} />
          </button>
        </footer>
      </div>
    </div>
  );
}

export function FilesPage(p: {
  settings: AppSettings | null;
  onAttach: () => void;
  onManage: () => void;
  onChat: (text: string) => void;
}) {
  return (
    <div className="page-scroll">
      <div className="page-content files-page">
        <div className="page-eyebrow">FILES & FOLDERS</div>
        <h1>
          Your files.
          <br />
          <span className="accent-text">A clearer picture.</span>
        </h1>
        <p className="page-lead">
          Attach a document or give your assistant a folder to work with.
        </p>
        <div className="file-upload-card">
          <span className="card-icon sage">
            <FolderOpen size={30} />
          </span>
          <h2>Start with a file</h2>
          <p>
            Ask for a summary, find something specific, or compare documents.
            The file will be added to a new conversation.
          </p>
          <button className="primary-button" onClick={p.onAttach}>
            <Plus size={16} /> Choose files
          </button>
          <span className="caption">
            Your assistant needs to be connected to read them.
          </span>
        </div>
        <div className="section-heading">
          <h2>Folders for your assistant</h2>
          <button className="text-button" onClick={p.onManage}>
            Manage folders <ArrowRight size={14} />
          </button>
        </div>
        {p.settings?.fileAccessPaths.length ? (
          <div className="folder-list">
            {p.settings.fileAccessPaths.map((path) => (
              <div className="folder-item" key={path}>
                <FolderOpen size={20} />
                <span>{path}</span>
                <button
                  className="text-button"
                  onClick={() =>
                    p.onChat(
                      `Help me find and organize files in ${path}. Start by listing what's there; show me a plan before moving or renaming anything.`,
                    )
                  }
                >
                  Ask about this folder <ArrowRight size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="folder-empty">
            <FolderOpen size={24} />
            <div>
              <strong>No folders added yet</strong>
              <p>
                Add a folder in settings so you can refer to it in
                conversations.
              </p>
            </div>
            <button className="secondary-button" onClick={p.onManage}>
              Add a folder
            </button>
          </div>
        )}
        <div className="info-note">
          <CircleHelp size={17} />
          <p>
            Folder guidance tells OpenClaw where to look; it is not a security
            sandbox. File and web tools depend on your OpenClaw configuration. A
            dedicated whole-PC search interface is still planned.
          </p>
        </div>
      </div>
    </div>
  );
}

export function InfoDialog({
  kind,
  onClose,
  onConnect,
}: {
  kind: "plan" | "help";
  onClose: () => void;
  onConnect: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        if (e.key === "Tab") {
          const nodes = Array.from(
            e.currentTarget.querySelectorAll<HTMLElement>(
              "button, input, a[href]",
            ),
          );
          const first = nodes[0],
            last = nodes[nodes.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <section
        className="info-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <button
          ref={closeRef}
          className="dialog-close icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={19} />
        </button>
        <span className="card-icon sage">
          <Sparkles size={24} />
        </span>
        <h2 id="dialog-title">
          {kind === "plan"
            ? "The next workflow: stock collection"
            : "A local assistant, with a little more reach."}
        </h2>
        {kind === "plan" ? (
          <>
            <p>
              Scheduled stock collection is in development. No collection or
              schedule is running yet.
            </p>
            <ol className="guide-steps">
              <li>
                <strong>Pick a watchlist</strong>
                <span>
                  US stocks and ETFs, with an editable list of symbols.
                </span>
              </li>
              <li>
                <strong>Collect and save locally</strong>
                <span>
                  Daily price and volume history, validation, and CSV export.
                  We’re evaluating no-account data sources.
                </span>
              </li>
              <li>
                <strong>Keep it up to date</strong>
                <span>
                  Run in the tray and catch up when your PC wakes or the app
                  reopens.
                </span>
              </li>
            </ol>
            <p className="caption">
              The first version collects data. It does not place trades.
            </p>
          </>
        ) : (
          <>
            <p>
              OpenClaw Desktop is the workspace you’re using now. It brings
              these pieces together:
            </p>
            <ol className="guide-steps">
              <li>
                <strong>Ollama runs the model</strong>
                <span>
                  You can leave Ollama open. You do not need to start a chat in
                  Ollama or choose its OpenClaw app tile.
                </span>
              </li>
              <li>
                <strong>OpenClaw provides the tools</strong>
                <span>
                  It runs in Ubuntu on this PC and connects your model to
                  configured file and research tools.
                </span>
              </li>
              <li>
                <strong>You work here</strong>
                <span>
                  Connect once, then use Conversations to ask questions and
                  Files & folders to bring in documents.
                </span>
              </li>
            </ol>
            <button className="primary-button" onClick={onConnect}>
              Check my connection <ArrowRight size={16} />
            </button>
          </>
        )}
      </section>
    </div>
  );
}
