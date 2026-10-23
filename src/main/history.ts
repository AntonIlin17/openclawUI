import { splitDesktopContext } from "../shared/message-context.js";
import type { ChatMessage } from "../shared/types.js";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function extractText(value: unknown): string {
  const message = record(value);
  if (typeof message.content === "string") return message.content;
  if (typeof message.text === "string") return message.text;
  if (Array.isArray(message.content))
    return message.content
      .map((part) => {
        const block = record(part);
        return (!block.type || block.type === "text") &&
          typeof block.text === "string"
          ? block.text
          : "";
      })
      .filter(Boolean)
      .join("\n");
  return message.message ? extractText(message.message) : "";
}

export function normalizeHistory(raw: unknown): ChatMessage[] {
  const source = record(raw);
  const history = Array.isArray(source.messages)
    ? source.messages
    : Array.isArray(source.history)
      ? source.history
      : [];
  const result: ChatMessage[] = [];
  for (const [index, item] of history.entries()) {
    const message = record(item);
    const id = String(message.id ?? `history-${index}`);
    const createdAt =
      typeof message.timestamp === "number"
        ? message.timestamp
        : typeof message.ts === "number"
          ? message.ts
          : index;
    const runId = typeof message.runId === "string" ? message.runId : undefined;
    const text = extractText(message);
    const base = { id, createdAt, runId };
    if (["tool", "toolResult", "tool_result"].includes(String(message.role))) {
      const callId = String(message.toolCallId ?? message.tool_use_id ?? id);
      const tool = result.find((entry) => entry.toolCallId === callId);
      const data = {
        role: "tool" as const,
        content: text,
        toolCallId: callId,
        toolName: String(
          message.toolName ?? message.name ?? tool?.toolName ?? "Tool",
        ),
        toolResult: message.content ?? message.result ?? text,
        toolPartial: false,
        toolError: message.isError === true,
      };
      if (tool) Object.assign(tool, data);
      else result.push({ ...base, ...data });
      continue;
    }
    if (message.role === "user") {
      const { userText, thinkingText } = splitDesktopContext(text);
      if (userText.trim())
        result.push({ ...base, role: "user", content: userText });
      if (thinkingText)
        result.push({
          ...base,
          id: `${id}-context`,
          role: "thinking",
          content: thinkingText,
          thinkingLabel: "File context",
        });
      continue;
    }
    if (message.role === "system") {
      if (text.trim())
        result.push({
          ...base,
          role: "thinking",
          content: text,
          thinkingLabel: "Session context",
        });
      continue;
    }
    if (message.role !== "assistant") continue;
    for (const [blockIndex, part] of (Array.isArray(message.content)
      ? message.content
      : []
    ).entries()) {
      const block = record(part);
      if (
        ["toolCall", "tool_use", "function_call"].includes(String(block.type))
      ) {
        const callId = String(
          block.id ?? block.toolCallId ?? `${id}-${blockIndex}`,
        );
        result.push({
          ...base,
          id: `tool-${callId}`,
          role: "tool",
          content: "",
          toolCallId: callId,
          toolName: String(block.name ?? "Tool"),
          toolArgs: block.arguments ?? block.input,
          toolPartial: false,
        });
      }
      if (["thinking", "reasoning"].includes(String(block.type))) {
        const thought =
          typeof block.thinking === "string"
            ? block.thinking
            : typeof block.text === "string"
              ? block.text
              : "";
        if (thought.trim())
          result.push({
            ...base,
            id: `${id}-thinking-${blockIndex}`,
            role: "thinking",
            content: thought,
            thinkingLabel: "Reasoning",
          });
      }
    }
    if (text.trim()) result.push({ ...base, role: "assistant", content: text });
  }
  return result;
}
