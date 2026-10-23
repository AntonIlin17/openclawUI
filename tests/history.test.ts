import assert from "node:assert/strict";
import { test } from "node:test";
import { extractText, normalizeHistory } from "../src/main/history.js";

test("history keeps tool calls/results out of assistant speech and merges them", () => {
  const messages = normalizeHistory({
    messages: [
      { role: "user", content: "Find a file" },
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call-1",
            name: "read",
            arguments: { path: "example.txt" },
          },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "read",
        content: [{ type: "text", text: "File contents" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "I found your file." }],
      },
    ],
  });
  assert.deepEqual(
    messages.map((message) => message.role),
    ["user", "tool", "assistant"],
  );
  assert.equal(messages[1].toolName, "read");
  assert.equal(messages[1].content, "File contents");
  assert.deepEqual(messages[1].toolArgs, { path: "example.txt" });
  assert.equal(messages[2].content, "I found your file.");
});

test("reasoning and system context stay in collapsible rows; empty assistant bubbles are omitted", () => {
  const messages = normalizeHistory({
    messages: [
      { role: "system", content: "System context" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Reasoning" },
          { type: "text", text: "Answer" },
        ],
      },
      { role: "assistant", content: [] },
    ],
  });
  assert.deepEqual(
    messages.map((message) => message.role),
    ["thinking", "thinking", "assistant"],
  );
  assert.equal(
    extractText({
      content: [
        { type: "thinking", text: "Hidden thought" },
        { type: "text", text: "Answer" },
      ],
    }),
    "Answer",
  );
});

test("preserves tool errors and accepts plain text history", () => {
  const messages = normalizeHistory({
    history: [
      {
        role: "toolResult",
        name: "read",
        isError: true,
        content: "File not found",
      },
      { role: "assistant", content: "Choose another file." },
    ],
  });
  assert.equal(messages[0].toolError, true);
  assert.equal(messages[0].role, "tool");
  assert.equal(messages[1].content, "Choose another file.");
});
