import type { MessageParam, ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { bedrock, ASSISTANT_MODEL_ID } from "./bedrock-client";
import { TOOLS, executeTool } from "./tools";

// Phase 5 Stream B (D14.1 / D14.4) — read-only admin AI assistant agent loop.
//
// runAgent is an async generator. The caller (the SSE route handler at
// /api/admin/assistant/conversations/[id]/messages POST) iterates events and
// re-encodes them as `event: <name>\ndata: <json>\n\n` SSE frames.
//
// LOOP SHAPE:
//   1. Persist the new user message as one AssistantMessage row.
//   2. Load all prior messages for this conversation, ORDER BY createdAt ASC.
//   3. Translate the flat row list into Anthropic's structured messages array
//      shape (text + tool_use blocks grouped under one 'assistant' message;
//      tool_result blocks wrapped as their own 'user' message). The
//      translation walks the rows in order; rows with role='user' or
//      role='tool_result' open a new message, rows with role='assistant'
//      or role='tool_use' append to the current assistant message's content.
//   4. Open a Bedrock stream. Yield 'text_delta' for every text delta; yield
//      'tool_use_start' for every tool_use block start.
//   5. After the stream ends, inspect stop_reason on finalMessage():
//        - 'tool_use': persist the assistant turn (text + tool_use rows),
//          execute each tool, persist a tool_result row, yield
//          'tool_use_result' for each. Increment toolCallCount. If
//          toolCallCount >= 10: yield 'error' and break (D14.4 cap).
//          Otherwise reload messages and loop back to step 4.
//        - 'end_turn': persist final text rows, yield 'done', return.
//        - Anything else: yield 'error' with the stop reason, return.
//   6. Catch surfaces yield a sanitized 'error' — Bedrock errors can
//      include creds-shaped strings in their messages, so we strip
//      AKIA-prefixed tokens before yielding the event payload.

const MAX_TOKENS = 4096;
const TOOL_CALL_CAP = 10;

const SYSTEM_PROMPT = [
  "You are bkstr's admin assistant. You help platform admins answer questions about users, books, grants, audit log, and fetch logs.",
  "You have 5 read-only tools — use them to query the database, never speculate about state you haven't fetched.",
  "You cannot make changes; if an admin asks you to mutate state, explain that you're read-only and point them at the relevant /dashboard/admin/* surface.",
  "Be concise. When a query is ambiguous, ask one clarifying question instead of guessing.",
].join(" ");

export type AgentEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_use_start"; toolUseId: string; name: string; input: Record<string, unknown> }
  | { type: "tool_use_result"; toolUseId: string; output: unknown }
  | { type: "done"; inputTokens: number; outputTokens: number }
  | { type: "error"; message: string };

// Stored content shapes (one DB row per content block).
type StoredText = { text: string };
type StoredToolUse = { toolUseId: string; name: string; input: Record<string, unknown> };
type StoredToolResult = { toolUseId: string; output: unknown };

// Sanitize an error message before exposing it to the client. Bedrock error
// strings occasionally echo AWS-creds-shaped tokens or internal stack
// frames; we strip those before emitting an 'error' SSE event. Full error
// is still logged server-side via console.error.
function sanitizeAgentError(err: unknown): string {
  let raw = err instanceof Error ? err.message : String(err);
  // Strip AWS access key IDs (AKIA[0-9A-Z]{16}) and ASIA temp creds.
  raw = raw.replace(/\b(AKIA|ASIA)[0-9A-Z]{16,}\b/g, "[REDACTED]");
  // Strip anything that looks like a 40-char secret key.
  raw = raw.replace(/\b[A-Za-z0-9/+=]{40,}\b/g, "[REDACTED]");
  if (raw.length > 500) raw = raw.slice(0, 500 - 3) + "...";
  return raw;
}

// Translate the flat AssistantMessage row list (one row per content block)
// into Anthropic's structured messages array. Walks the rows in createdAt
// order; user/tool_result rows open new messages, assistant/tool_use rows
// append blocks to the current assistant message.
function rowsToMessages(
  rows: Array<{ role: string; content: unknown }>,
): MessageParam[] {
  const out: MessageParam[] = [];
  let currentAssistant: { role: "assistant"; content: ContentBlockParam[] } | null = null;
  let currentToolResults: { role: "user"; content: ContentBlockParam[] } | null = null;

  function flushAssistant() {
    if (currentAssistant && currentAssistant.content.length > 0) {
      out.push(currentAssistant);
    }
    currentAssistant = null;
  }
  function flushToolResults() {
    if (currentToolResults && currentToolResults.content.length > 0) {
      out.push(currentToolResults);
    }
    currentToolResults = null;
  }

  for (const row of rows) {
    if (row.role === "user") {
      flushAssistant();
      flushToolResults();
      const c = row.content as StoredText;
      out.push({ role: "user", content: c.text });
      continue;
    }
    if (row.role === "assistant") {
      flushToolResults();
      if (!currentAssistant) currentAssistant = { role: "assistant", content: [] };
      const c = row.content as StoredText;
      currentAssistant.content.push({ type: "text", text: c.text });
      continue;
    }
    if (row.role === "tool_use") {
      flushToolResults();
      if (!currentAssistant) currentAssistant = { role: "assistant", content: [] };
      const c = row.content as StoredToolUse;
      currentAssistant.content.push({
        type: "tool_use",
        id: c.toolUseId,
        name: c.name,
        input: c.input,
      });
      continue;
    }
    if (row.role === "tool_result") {
      flushAssistant();
      if (!currentToolResults) currentToolResults = { role: "user", content: [] };
      const c = row.content as StoredToolResult;
      currentToolResults.content.push({
        type: "tool_result",
        tool_use_id: c.toolUseId,
        content: JSON.stringify(c.output),
      });
      continue;
    }
    // Unknown role — skip with a console.warn but do not throw. This is
    // defensive against schema drift between Stream B and a future Stream
    // adding new row types.
    console.warn(`[assistant] unknown stored message role: ${row.role}`);
  }
  flushAssistant();
  flushToolResults();
  return out;
}

export type RunAgentArgs = {
  conversationId: string;
  newUserMessage: string;
  ownerUserId: string;
};

export async function* runAgent(
  args: RunAgentArgs,
): AsyncGenerator<AgentEvent, void, unknown> {
  const { conversationId, newUserMessage } = args;

  try {
    // Step 1 — persist the user message.
    await prisma.assistantMessage.create({
      data: {
        conversationId,
        role: "user",
        content: { text: newUserMessage } as unknown as Prisma.InputJsonValue,
      },
    });
    // Bump the parent conversation's updatedAt so the list-conversations
    // surface re-orders recently-active conversations to the top.
    await prisma.assistantConversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    let toolCallCount = 0;
    let lastInputTokens = 0;
    let lastOutputTokens = 0;

    // Step 2-5 — agent loop.
    // The outer while(true) runs the LLM, persists the response, executes
    // any tool calls, persists the results, and re-runs the LLM until
    // stop_reason='end_turn' OR the tool-call cap is hit OR an error
    // bubbles out.
    while (true) {
      // Reload all rows each iteration so the in-DB state IS the in-prompt
      // state. Cheap (a single index scan on conversation_id) and avoids
      // an "in-memory vs DB" drift class of bug.
      const rows = await prisma.assistantMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: "asc" },
        select: { role: true, content: true },
      });
      const messages = rowsToMessages(rows);

      // Open a streaming Bedrock request. Per D14.4 we omit `thinking`,
      // `temperature`, `top_p`, and `top_k` so the request shape is
      // forward-compatible with the future Opus 4.7 upgrade (follow-up
      // #84).
      // The TOOLS array's input_schema is a `readonly` JSON Schema literal
      // typed via `as const`; Anthropic's `Tool[]` type wants a mutable
      // `InputSchema` shape. Cast through `unknown` — the runtime payload
      // is correct (JSON Schema dictates `type: 'object'` for the root
      // which our literals satisfy), this cast only widens the
      // TypeScript-side view to match the SDK's parameter type.
      const stream = bedrock.messages.stream({
        model: ASSISTANT_MODEL_ID,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        tools: TOOLS as unknown as Parameters<typeof bedrock.messages.stream>[0]["tools"],
        messages,
      });

      // Track tool_use blocks as they stream in so we can emit
      // tool_use_start events with their full input. Anthropic streams
      // tool inputs as partial JSON deltas; we await the assembled
      // version from finalMessage() below.
      const emittedToolUseStarts = new Set<string>();

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield { type: "text_delta", delta: event.delta.text };
        }
      }

      // Stream ended — fetch the assembled message.
      const finalMessage = await stream.finalMessage();
      lastInputTokens = finalMessage.usage?.input_tokens ?? lastInputTokens;
      lastOutputTokens = finalMessage.usage?.output_tokens ?? lastOutputTokens;

      // Persist the assistant turn's content blocks. One row per block.
      // The model row IS the persistence record for the LLM's response;
      // we attribute the token usage to whatever the LAST block of the
      // turn is (arbitrary but stable choice — Stream C+ may revisit).
      const turnBlocks = finalMessage.content;
      for (let i = 0; i < turnBlocks.length; i++) {
        const block = turnBlocks[i];
        const isLast = i === turnBlocks.length - 1;
        if (block.type === "text") {
          await prisma.assistantMessage.create({
            data: {
              conversationId,
              role: "assistant",
              content: { text: block.text } as unknown as Prisma.InputJsonValue,
              modelId: ASSISTANT_MODEL_ID,
              inputTokens: isLast ? lastInputTokens : null,
              outputTokens: isLast ? lastOutputTokens : null,
            },
          });
        } else if (block.type === "tool_use") {
          // Emit the tool_use_start event now that we have the assembled
          // input. We dedupe via emittedToolUseStarts so we don't double-
          // emit if the stream-iteration path also enqueued one.
          if (!emittedToolUseStarts.has(block.id)) {
            emittedToolUseStarts.add(block.id);
            yield {
              type: "tool_use_start",
              toolUseId: block.id,
              name: block.name,
              input: block.input as Record<string, unknown>,
            };
          }
          await prisma.assistantMessage.create({
            data: {
              conversationId,
              role: "tool_use",
              content: {
                toolUseId: block.id,
                name: block.name,
                input: block.input,
              } as unknown as Prisma.InputJsonValue,
              modelId: ASSISTANT_MODEL_ID,
              inputTokens: isLast ? lastInputTokens : null,
              outputTokens: isLast ? lastOutputTokens : null,
            },
          });
        }
      }

      // Inspect stop_reason.
      if (finalMessage.stop_reason === "end_turn") {
        yield {
          type: "done",
          inputTokens: lastInputTokens,
          outputTokens: lastOutputTokens,
        };
        return;
      }

      if (finalMessage.stop_reason === "tool_use") {
        // Execute every tool_use block. Bedrock can emit multiple tool
        // calls in one turn; we run them sequentially (cheap, deterministic
        // ordering).
        for (const block of turnBlocks) {
          if (block.type !== "tool_use") continue;
          toolCallCount++;
          if (toolCallCount > TOOL_CALL_CAP) {
            yield {
              type: "error",
              message: `Tool-call limit (${TOOL_CALL_CAP}) reached for this turn; stopping`,
            };
            return;
          }

          let output: unknown;
          try {
            output = await executeTool(
              block.name,
              block.input as Record<string, unknown>,
            );
          } catch (toolErr) {
            // Tool-execution errors propagate to the model as a tool_result
            // payload with an error field rather than aborting the whole
            // conversation. The model can decide whether to retry, ask the
            // user for clarification, or give up.
            console.error(`[assistant] tool '${block.name}' threw:`, toolErr);
            output = {
              error: sanitizeAgentError(toolErr),
            };
          }

          await prisma.assistantMessage.create({
            data: {
              conversationId,
              role: "tool_result",
              content: { toolUseId: block.id, output } as unknown as Prisma.InputJsonValue,
            },
          });
          yield { type: "tool_use_result", toolUseId: block.id, output };
        }
        // Loop back to step 2-4 — re-read messages (now including the
        // tool_results) and re-prompt the model.
        continue;
      }

      // Any other stop_reason (max_tokens, stop_sequence, refusal, …) is
      // a non-terminal-from-the-model perspective but terminal for our
      // loop. Surface it as an error so the UI can show it; persist
      // nothing extra (the text/tool_use blocks already persisted above).
      yield {
        type: "error",
        message: `Stream ended with unsupported stop_reason: ${finalMessage.stop_reason ?? "null"}`,
      };
      return;
    }
  } catch (err) {
    console.error("[assistant] runAgent failed:", err);
    yield { type: "error", message: sanitizeAgentError(err) };
    return;
  }
}
