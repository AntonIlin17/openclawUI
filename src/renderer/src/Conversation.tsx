import React, { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Copy,
  Mic,
  Paperclip,
  Square,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import hljs from "highlight.js";
import mermaid from "mermaid";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github.css";
import "./styles.css";
import type {
  ActiveRunStatus,
  AppSettings,
  Attachment,
  ChatMessage,
  GatewayStatus,
  ThinkingLevel,
} from "../../shared/types";
export function ChatView(props: {
  messages: ChatMessage[];
  sessionKey: string;
  settings: AppSettings | null;
  activeRun?: ActiveRunStatus;
  onCancelRun: () => void;
  onSent: (input: {
    sessionKey: string;
    message: string;
    thinking: ThinkingLevel;
    attachments: Attachment[];
  }) => Promise<void>;
  connected: boolean;
  initialText?: string;
  initialAttachments?: Attachment[];
  onDraftChange: (text: string, attachments: Attachment[]) => void;
}) {
  const [text, setText] = useState(props.initialText ?? "");
  const [attachments, setAttachments] = useState<Attachment[]>(
    props.initialAttachments ?? [],
  );
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const elapsed = useElapsedMs(
    props.activeRun?.startedAt,
    Boolean(props.activeRun),
  );
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    props.onDraftChange(text, attachments);
  }, [text, attachments]);
  useEffect(() => {
    const node = listRef.current;
    if (!node) {
      return;
    }
    const nearBottom =
      node.scrollHeight - node.scrollTop - node.clientHeight < 180;
    if (nearBottom) {
      node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    }
  }, [props.messages]);
  async function send() {
    if (
      !props.connected ||
      sending ||
      props.activeRun ||
      (!text.trim() && !attachments.length)
    )
      return;
    setSending(true);
    setSendError(null);
    try {
      await props.onSent({
        sessionKey: props.sessionKey,
        message: text.trim(),
        thinking: props.settings?.thinking ?? "brief",
        attachments,
      });
      setText("");
      setAttachments([]);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  }
  async function attachFiles(paths?: string[]) {
    if (!paths?.length) {
      return;
    }
    const resolved = await window.openclaw.resolveDroppedFiles(paths);
    setAttachments((items) => [...items, ...resolved]);
  }
  const canSend =
    props.connected &&
    !sending &&
    !props.activeRun &&
    (Boolean(text.trim()) || attachments.length > 0);
  return (
    <>
      <div
        className="messages"
        ref={listRef}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const paths = [...event.dataTransfer.files]
            .map((file) => file.path)
            .filter(Boolean);
          void attachFiles(paths).catch((error) => setSendError(String(error)));
        }}
      >
        {!props.messages.length ? (
          <div className="chat-welcome">
            <span className="assistant-orb">
              <Bot size={26} />
            </span>
            <h2>Start with what you need.</h2>
            <p>
              Ask a question or attach a file. Your assistant runs locally
              through OpenClaw.
            </p>
          </div>
        ) : null}
        {props.messages.map((message) => (
          <MessageRow key={message.id} message={message} />
        ))}
      </div>
      <div className="composer-wrap">
        {props.activeRun ? (
          <div className="run-progress" role="status">
            <span className="activity-dot" />
            <strong>
              {props.activeRun.cancelRequested
                ? "Stopping…"
                : (props.activeRun.activity ?? "Working on your request…")}
            </strong>
            <span>
              {formatElapsed(elapsed)} · You can stop this run at any time.
            </span>
          </div>
        ) : null}
        {sendError ? (
          <p className="inline-error" role="alert">
            {sendError} Your message is still here. Try again when connected.
          </p>
        ) : null}
        {attachments.length ? (
          <div className="attachments">
            {attachments.map((item) => (
              <span className="chip" key={item.id}>
                {item.name}
                <button
                  onClick={() =>
                    setAttachments((all) =>
                      all.filter((entry) => entry.id !== item.id),
                    )
                  }
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="composer">
          <button
            title="Attach"
            onClick={() =>
              void window.openclaw
                .chooseAttachmentFiles()
                .then((files) =>
                  setAttachments((items) => [...items, ...files]),
                )
                .catch((error) => setSendError(String(error)))
            }
          >
            <Paperclip size={18} />
          </button>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            onPaste={(event) => {
              const image = [...event.clipboardData.files].find((file) =>
                file.type.startsWith("image/"),
              );
              if (image) {
                const reader = new FileReader();
                reader.onload = () =>
                  setAttachments((items) => [
                    ...items,
                    {
                      id: crypto.randomUUID(),
                      name: image.name || "pasted-image.png",
                      type: image.type,
                      dataUrl: String(reader.result),
                    },
                  ]);
                reader.readAsDataURL(image);
              }
            }}
            aria-label="Message your assistant"
            placeholder={
              props.connected
                ? "Ask your assistant anything…"
                : "Write a message. Connect your assistant to send it."
            }
          />
          <button
            disabled={
              !window.SpeechRecognition && !window.webkitSpeechRecognition
            }
            className={recording ? "recording" : ""}
            title="Voice input"
            onClick={() => startVoice(setText, setRecording)}
          >
            <Mic size={18} />
          </button>
          {props.activeRun ? (
            <button
              className="send cancel-run"
              title="Stop current run"
              disabled={props.activeRun.cancelRequested}
              onClick={props.onCancelRun}
            >
              <Square size={18} />
            </button>
          ) : (
            <button
              className="send"
              title="Send message"
              aria-label="Send message"
              disabled={!canSend}
              onClick={() => void send()}
            >
              <ArrowUp size={18} />
            </button>
          )}
        </div>
        <p className="composer-hint">
          Enter to send · Shift + Enter for a new line · Check important results
        </p>
      </div>
    </>
  );
}
function MessageRow({ message }: { message: ChatMessage }) {
  if (message.role === "thinking") {
    return <ThinkingCard message={message} />;
  }
  if (message.role === "tool") {
    return <ToolCard message={message} />;
  }
  return <MessageBubble message={message} />;
}
function ThinkingCard({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const label = message.thinkingLabel ?? "Thinking";
  return (
    <div className="thinking-card">
      <button className="thinking-summary" onClick={() => setOpen(!open)}>
        <ChevronDown
          size={13}
          className={open ? "thinking-chevron open" : "thinking-chevron"}
        />
        <strong>{label}</strong>
        <span>{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <div className="thinking-detail">
          <pre>{message.content}</pre>
        </div>
      ) : null}
    </div>
  );
}
function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <article className={`message ${message.role}`}>
      <div className="avatar">{message.role === "user" ? "You" : "OC"}</div>
      <div className="message-body">
        <button
          className="copy-message"
          title="Copy"
          onClick={() => void navigator.clipboard.writeText(message.content)}
        >
          <Copy size={14} />
        </button>
        <Markdown content={message.content} />
        {message.attachments?.length ? (
          <div className="attachments sent">
            {message.attachments.map((item) => (
              <span className="chip" key={item.id}>
                {item.name}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}
function ToolCard({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const errorHint = message.toolError ? toolErrorHint(message) : "";
  return (
    <div className="tool-card">
      <button className="tool-summary" onClick={() => setOpen(!open)}>
        <span>
          {message.toolPartial ? <Square size={13} /> : <Check size={13} />}
        </span>
        <strong>{message.toolName ?? "tool"}</strong>
        <span className={message.toolError ? "tool-state-error" : undefined}>
          {message.toolPartial
            ? "running"
            : message.toolError
              ? "error"
              : "complete"}
        </span>
      </button>
      {message.toolError ? (
        <p className="tool-error-text">{errorHint}</p>
      ) : null}
      {open ? (
        <div className="tool-detail">
          <pre>
            {JSON.stringify(
              { args: message.toolArgs, result: message.toolResult },
              null,
              2,
            )}
          </pre>
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
            const highlighted = hljs.getLanguage(lang)
              ? hljs.highlight(raw, { language: lang }).value
              : hljs.highlightAuto(raw).value;
            return (
              <div className="code-block">
                <button
                  title="Copy code"
                  onClick={() => void navigator.clipboard.writeText(raw)}
                >
                  <Copy size={14} />
                </button>
                <pre>
                  <code dangerouslySetInnerHTML={{ __html: highlighted }} />
                </pre>
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
    mermaid.initialize({
      startOnLoad: false,
      theme: "neutral",
      securityLevel: "strict",
    });
    void mermaid
      .render(`m-${crypto.randomUUID()}`, code)
      .then((result) => setSvg(result.svg))
      .catch(() => setSvg(""));
  }, [code]);
  return svg ? (
    <div className="diagram" dangerouslySetInnerHTML={{ __html: svg }} />
  ) : (
    <pre>{code}</pre>
  );
}
function ChartBlock({ code }: { code: string }) {
  return <pre className="chart-block">{code}</pre>;
}
function useElapsedMs(startedAt?: number, active = false): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active || !startedAt) {
      return;
    }
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);
  return active && startedAt ? Math.max(0, now - startedAt) : 0;
}
function formatStatusLine(status: GatewayStatus, elapsedMs: number): string {
  const activeRun = status.activeRun;
  if (
    activeRun &&
    (status.state === "running" || status.state === "streaming")
  ) {
    const label = activeRun.cancelRequested
      ? "OpenClaw cancelling"
      : "OpenClaw running";
    const activity = activeRun.activity ?? status.detail ?? "Working";
    return `${label} Â· ${formatElapsed(elapsedMs)} Â· ${activity}`;
  }
  return status.detail ?? status.state;
}
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
function toolErrorHint(message: ChatMessage): string {
  const name = message.toolName ?? "tool";
  const detail = stringifyToolValue(message.toolResult || message.content);
  if (
    /tool.*not found|not found.*tool|unknown tool|missing tool/i.test(
      `${name} ${detail}`,
    )
  ) {
    return `OpenClaw Gateway reported that ${name} is not available. Check ~/.openclaw/openclaw.json or run openclaw doctor in WSL, then restart the gateway.`;
  }
  return `OpenClaw Gateway reported an error while running ${name}. Expand for the raw result.`;
}
function stringifyToolValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
function startVoice(
  setText: React.Dispatch<React.SetStateAction<string>>,
  setRecording: React.Dispatch<React.SetStateAction<boolean>>,
) {
  const Speech = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!Speech) {
    return;
  }
  const recognition = new Speech();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.onstart = () => setRecording(true);
  recognition.onend = () => setRecording(false);
  recognition.onresult = (event: {
    results: ArrayLike<SpeechRecognitionResult>;
  }) => {
    const transcript = Array.from(event.results)
      .map((result) => (result as SpeechRecognitionResult)[0]?.transcript ?? "")
      .join("");
    setText(
      (previous) =>
        `${previous}${previous && transcript ? " " : ""}${transcript}`,
    );
  };
  recognition.start();
}
