"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Phase 5 Stream B (D14.1) — admin AI assistant pane.
//
// Left rail: conversation list (with "New" button, soft-delete via X icon).
// Main pane: message list + streaming tool-use indicator + input bar.
//
// SSE parsing: fetch + getReader + TextDecoder + manual frame split on
// `\n\n` (event boundary). Each frame has `event: <name>` and `data: <json>`
// lines per the SSE wire format that /api/admin/assistant/.../messages POST
// emits. No new dep for SSE parsing — the EventSource browser API can't be
// used because it doesn't support POST.
//
// MARKDOWN: ReactMarkdown + remarkGfm for assistant text. The
// `@tailwindcss/typography` plugin is NOT installed (verified at
// src/app/dashboard/docs/page.tsx:49-55), so the `prose` class would be
// unstyled. Falling back to a plain wrapper with space-y rhythm.
//
// bkstr redesign PR 5 — restyled with design tokens.

type Conversation = {
  id: string;
  title: string | null;
  updatedAt: string;
  messageCount: number;
};

type StoredMessage = {
  id: string;
  role: string;
  // JSONB content payload — shape varies by role per the agent's storage
  // contract (src/lib/admin/assistant/agent.ts).
  content: unknown;
  createdAt: string;
};

type StreamingToolCall = {
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
};

export function AssistantPane({
  initialConversations,
}: {
  initialConversations: Conversation[];
}) {
  const [conversations, setConversations] = useState<Conversation[]>(initialConversations);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamingToolCalls, setStreamingToolCalls] = useState<StreamingToolCall[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll the message list to the bottom on every render that adds
  // content. Cheap; only one scrollable element.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streamingText, streamingToolCalls]);

  const refreshConversations = useCallback(async () => {
    const res = await fetch("/api/admin/assistant/conversations", {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return;
    const list = (await res.json()) as Conversation[];
    setConversations(list);
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    const res = await fetch(
      `/api/admin/assistant/conversations/${conversationId}/messages`,
      { method: "GET", headers: { Accept: "application/json" } },
    );
    if (!res.ok) {
      setMessages([]);
      return;
    }
    const rows = (await res.json()) as StoredMessage[];
    setMessages(rows);
  }, []);

  async function handleNew() {
    const res = await fetch("/api/admin/assistant/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) return;
    const created = (await res.json()) as { id: string };
    await refreshConversations();
    setActiveId(created.id);
    setMessages([]);
    setStreamingText("");
    setStreamingToolCalls([]);
    setStreamError(null);
  }

  async function handleDelete(conversationId: string) {
    if (!confirm("Archive this conversation? It will be hidden from the list.")) return;
    const res = await fetch(`/api/admin/assistant/conversations/${conversationId}`, {
      method: "DELETE",
    });
    if (!res.ok) return;
    if (activeId === conversationId) {
      setActiveId(null);
      setMessages([]);
    }
    await refreshConversations();
  }

  async function handleSelect(conversationId: string) {
    setActiveId(conversationId);
    setStreamingText("");
    setStreamingToolCalls([]);
    setStreamError(null);
    await loadMessages(conversationId);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (streaming) return;
    if (!input.trim()) return;

    let conversationId = activeId;
    // Auto-create a conversation if the user submits without picking one.
    if (!conversationId) {
      const res = await fetch("/api/admin/assistant/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) return;
      const created = (await res.json()) as { id: string };
      conversationId = created.id;
      setActiveId(conversationId);
      await refreshConversations();
    }

    const userMessage = input;
    setInput("");
    setStreaming(true);
    setStreamingText("");
    setStreamingToolCalls([]);
    setStreamError(null);

    // Optimistic append of the user message so the UI doesn't flash empty.
    setMessages((prev) => [
      ...prev,
      {
        id: `optimistic-${Date.now()}`,
        role: "user",
        content: { text: userMessage },
        createdAt: new Date().toISOString(),
      },
    ]);

    try {
      const res = await fetch(
        `/api/admin/assistant/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: userMessage }),
        },
      );
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        setStreamError(`Request failed (${res.status}): ${text.slice(0, 200)}`);
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      // Track tool calls locally so we update by toolUseId without depending
      // on state-batching timing inside setStreamingToolCalls.
      const localTools: StreamingToolCall[] = [];

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // Split on the SSE event boundary `\n\n`. Anything before the last
        // boundary is a complete frame; the trailing fragment stays in buf
        // for the next read.
        let boundary = buf.indexOf("\n\n");
        while (boundary !== -1) {
          const frame = buf.slice(0, boundary);
          buf = buf.slice(boundary + 2);
          handleFrame(frame);
          boundary = buf.indexOf("\n\n");
        }
      }

      function handleFrame(frame: string) {
        let eventType = "message";
        let dataLine = "";
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) eventType = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLine = line.slice(5).trim();
        }
        if (!dataLine) return;
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(dataLine);
        } catch {
          return;
        }

        switch (eventType) {
          case "text_delta": {
            const delta = typeof payload.delta === "string" ? payload.delta : "";
            setStreamingText((prev) => prev + delta);
            break;
          }
          case "tool_use_start": {
            const tc: StreamingToolCall = {
              toolUseId: String(payload.toolUseId ?? ""),
              name: String(payload.name ?? "<unknown>"),
              input: (payload.input as Record<string, unknown>) ?? {},
            };
            localTools.push(tc);
            setStreamingToolCalls([...localTools]);
            break;
          }
          case "tool_use_result": {
            const id = String(payload.toolUseId ?? "");
            const found = localTools.find((t) => t.toolUseId === id);
            if (found) found.output = payload.output;
            setStreamingToolCalls([...localTools]);
            break;
          }
          case "done":
          case "error": {
            if (eventType === "error") {
              setStreamError(String(payload.message ?? "Stream errored"));
            }
            break;
          }
        }
      }
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : "Stream failed");
    } finally {
      setStreaming(false);
      // Reload authoritative DB state — the streaming text / tool buffers
      // are throw-away; the DB rows are the source of truth.
      if (conversationId) {
        await loadMessages(conversationId);
        await refreshConversations();
      }
      setStreamingText("");
      setStreamingToolCalls([]);
    }
  }

  return (
    <div className="flex border border-rule overflow-hidden bg-paper" style={{ height: "70vh" }}>
      {/* Left rail */}
      <aside className="w-64 bg-paper-2 border-r border-rule flex flex-col">
        <div className="p-4 border-b border-rule">
          <button
            type="button"
            onClick={handleNew}
            className="w-full bg-ink text-paper px-4 py-2 font-mono text-[11px] tracking-eyebrow uppercase hover:bg-ink-2 transition-colors"
          >
            + New conversation
          </button>
        </div>
        <div className="flex-grow overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="p-4 text-xs text-ink-3">No conversations yet.</div>
          ) : (
            <ul className="p-2 space-y-1">
              {conversations.map((c) => {
                const isActive = c.id === activeId;
                return (
                  <li key={c.id}>
                    <div
                      className={`group flex items-center justify-between gap-2 px-3 py-2 cursor-pointer text-sm border-l-2 ${
                        isActive
                          ? "bg-paper text-ink border-saffron-dk"
                          : "border-transparent text-ink-2 hover:bg-paper hover:text-ink"
                      }`}
                      onClick={() => handleSelect(c.id)}
                    >
                      <div className="truncate">
                        <div className="font-serif truncate">{c.title || "(untitled)"}</div>
                        <div className="font-mono text-[11px] text-ink-3">
                          {c.messageCount} {c.messageCount === 1 ? "message" : "messages"}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(c.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-xs text-ink-3 hover:text-status-err"
                        aria-label="Archive conversation"
                      >
                        x
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* Main pane */}
      <section className="flex-grow flex flex-col bg-paper">
        <div ref={scrollerRef} className="flex-grow overflow-y-auto p-6 space-y-4">
          {messages.length === 0 && !streamingText && streamingToolCalls.length === 0 ? (
            <div className="text-sm text-ink-3 max-w-xl">
              Ask me anything about platform users, books, grants, or activity. I
              have read access to the database. Try: &ldquo;How many active grants are
              there?&rdquo; or &ldquo;Show me admin actions from the last 24 hours.&rdquo;
            </div>
          ) : (
            <>
              {messages.map((m) => (
                <MessageRow key={m.id} message={m} />
              ))}
            </>
          )}

          {/* Live tool-call indicators (rendered above streaming text since
              tool_use blocks precede the final text in stop_reason='end_turn'
              turns; rendered above too for tool_use turns which have no
              trailing text). */}
          {streamingToolCalls.map((tc) => (
            <ToolCallCard key={tc.toolUseId} tc={tc} />
          ))}

          {streamingText && (
            <div className="bg-paper-2 border border-rule p-4 text-sm">
              <div className="font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 mb-2">Assistant</div>
              <article className="space-y-2 text-ink-2">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingText}</ReactMarkdown>
              </article>
            </div>
          )}

          {streamError && (
            <div className="bg-paper border border-status-err text-status-err text-sm px-4 py-3">
              {streamError}
            </div>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          className="border-t border-rule p-4 flex gap-2 bg-paper-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              streaming
                ? "Waiting for response..."
                : "Ask a question about platform state..."
            }
            disabled={streaming}
            aria-label="Ask the assistant"
            className="flex-grow px-3 py-2 border border-rule bg-paper text-sm text-ink disabled:opacity-50 placeholder:text-ink-3 focus:outline-none focus:border-ink"
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="bg-ink text-paper px-4 py-2 font-mono text-[11px] tracking-eyebrow uppercase hover:bg-ink-2 transition-colors disabled:opacity-50"
          >
            {streaming ? "..." : "Send"}
          </button>
        </form>
      </section>
    </div>
  );
}

function MessageRow({ message }: { message: StoredMessage }) {
  const c = message.content as Record<string, unknown> | null | undefined;
  if (message.role === "user") {
    const text = typeof c?.text === "string" ? c.text : "";
    return (
      <div className="bg-paper-2 border border-rule p-4 text-sm">
        <div className="font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 mb-2">You</div>
        <div className="whitespace-pre-wrap text-ink-2">{text}</div>
      </div>
    );
  }
  if (message.role === "assistant") {
    const text = typeof c?.text === "string" ? c.text : "";
    return (
      <div className="bg-paper border border-rule p-4 text-sm">
        <div className="font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 mb-2">Assistant</div>
        {/* Tailwind typography plugin not installed — falling back to a
            plain wrapper with space-y rhythm. Same pattern as Stream A's
            docs surface (src/app/dashboard/docs/page.tsx:49-55). */}
        <article className="space-y-2 text-ink-2">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </article>
      </div>
    );
  }
  if (message.role === "tool_use") {
    const name = typeof c?.name === "string" ? c.name : "<tool>";
    const input = (c?.input as Record<string, unknown>) ?? {};
    return (
      <details className="text-xs text-ink-3 bg-paper border border-rule px-3 py-2">
        <summary className="cursor-pointer">
          <span className="font-mono text-ink-2">{name}</span>(
          {Object.keys(input).length === 0 ? "" : "..."}) called
        </summary>
        <pre className="mt-2 whitespace-pre-wrap text-[11px] font-mono">
          {JSON.stringify(input, null, 2)}
        </pre>
      </details>
    );
  }
  if (message.role === "tool_result") {
    const output = c?.output ?? null;
    const preview = JSON.stringify(output);
    return (
      <details className="text-xs text-ink-3 bg-paper border border-rule px-3 py-2">
        <summary className="cursor-pointer">
          Result: {preview.length > 80 ? preview.slice(0, 80) + "..." : preview}
        </summary>
        <pre className="mt-2 whitespace-pre-wrap text-[11px] font-mono">
          {JSON.stringify(output, null, 2)}
        </pre>
      </details>
    );
  }
  return null;
}

function ToolCallCard({ tc }: { tc: StreamingToolCall }) {
  return (
    <div className="text-xs text-ink-3 bg-paper border border-rule px-3 py-2">
      <div>
        <span className="font-mono text-ink-2">{tc.name}</span> called
        {tc.output === undefined ? " (running...)" : " "}
      </div>
      {tc.output !== undefined && (
        <details className="mt-1">
          <summary className="cursor-pointer">Result</summary>
          <pre className="mt-2 whitespace-pre-wrap text-[11px] font-mono">
            {JSON.stringify(tc.output, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
