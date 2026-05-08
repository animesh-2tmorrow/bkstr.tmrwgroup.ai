import type { NextRequest } from "next/server";
import { InvokeModelWithResponseStreamCommand } from "@aws-sdk/client-bedrock-runtime";
import { ApiKeyAuthError, requireApiKey } from "@/lib/auth/api-key";
import { prisma } from "@/lib/db";
import { bedrockClient } from "@/lib/bedrock";
import {
  MAX_CONTENT_TOKENS,
  buildSystemPrompt,
  estimateTokens,
} from "@/lib/agent/system-prompt";
import { cacheKey, getCached, setCached } from "@/lib/agent/cache";
import { sanitizeError } from "@/lib/agent/sanitize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL_ID = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
const MAX_TOKENS = 2000;
const MAX_QUERY_LEN = 8000;
const FIRST_TOKEN_TIMEOUT_MS = 30_000;
const CHUNK_REPLAY_SIZE = 50;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
} as const;

type FetchStatus = "success" | "error" | "timeout" | "content_too_large" | "cache_hit";

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function chunkText(text: string, size: number): string[] {
  if (text.length === 0) return [];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

export async function POST(request: NextRequest): Promise<Response> {
  // 1. Auth
  let auth: Awaited<ReturnType<typeof requireApiKey>>;
  try {
    auth = await requireApiKey(request);
  } catch (err) {
    if (err instanceof ApiKeyAuthError) {
      return jsonResponse({ error: err.message }, err.status);
    }
    throw err;
  }

  // 2. Parse + validate body
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  const body = raw as { book_id?: unknown; version_id?: unknown; query?: unknown };
  if (typeof body.book_id !== "string" || !UUID_REGEX.test(body.book_id)) {
    return jsonResponse({ error: "book_id required (uuid)" }, 400);
  }
  if (
    body.version_id !== undefined &&
    (typeof body.version_id !== "string" || !UUID_REGEX.test(body.version_id))
  ) {
    return jsonResponse({ error: "version_id must be a uuid" }, 400);
  }
  if (typeof body.query !== "string" || body.query.length === 0) {
    return jsonResponse({ error: "query required (non-empty string)" }, 400);
  }
  if (body.query.length > MAX_QUERY_LEN) {
    return jsonResponse({ error: `query exceeds ${MAX_QUERY_LEN} chars` }, 400);
  }
  const query: string = body.query;
  const bookId: string = body.book_id;
  const versionId: string | undefined = body.version_id as string | undefined;

  // 3. Look up book + version. No subscriber-to-book auth check (D5.11 / #32).
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: { id: true },
  });
  if (!book) return jsonResponse({ error: "Book not found" }, 404);

  const version = versionId
    ? await prisma.bookVersion.findUnique({
        where: { id: versionId },
        select: { id: true, bookId: true, content: true },
      })
    : await prisma.bookVersion.findFirst({
        where: { bookId: book.id },
        orderBy: { version: "desc" },
        select: { id: true, bookId: true, content: true },
      });

  if (!version || version.bookId !== book.id) {
    return jsonResponse({ error: "Book version not found" }, 404);
  }
  if (!version.content || version.content.length === 0) {
    return jsonResponse({ error: "Book version has no content" }, 404);
  }

  // From here on, every code path produces a fetch_logs row.
  const start = Date.now();
  let status: FetchStatus = "success";
  let errorMessage: string | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;

  const writeLog = async () => {
    try {
      await prisma.fetchLog.create({
        data: {
          subscriberId: auth.subscriber.id,
          bookVersionId: version.id,
          apiKeyId: auth.apiKey.id,
          model: MODEL_ID,
          query,
          inputTokens,
          outputTokens,
          latencyMs: Date.now() - start,
          status,
          errorMessage,
        },
      });
    } catch (err) {
      console.error("[agent/fetch] failed to write fetch_logs:", sanitizeError(err));
    }
  };

  // 4. Size guard
  if (estimateTokens(version.content) > MAX_CONTENT_TOKENS) {
    status = "content_too_large";
    errorMessage = `content_estimate exceeds ${MAX_CONTENT_TOKENS} tokens`;
    try {
      return jsonResponse({ error: "Content exceeds size limit" }, 413);
    } finally {
      await writeLog();
    }
  }

  // 5. Cache lookup
  const ck = cacheKey(version.id, query);
  const cached = getCached(ck);
  if (cached) {
    status = "cache_hit";
    inputTokens = cached.input_tokens;
    outputTokens = cached.output_tokens;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        try {
          for (const piece of chunkText(cached.text, CHUNK_REPLAY_SIZE)) {
            controller.enqueue(enc.encode(sseEvent("chunk", { text: piece })));
          }
          controller.enqueue(
            enc.encode(
              sseEvent("done", {
                input_tokens: cached.input_tokens,
                output_tokens: cached.output_tokens,
                latency_ms: Date.now() - start,
              }),
            ),
          );
        } finally {
          controller.close();
          await writeLog();
        }
      },
    });
    return new Response(stream, { headers: SSE_HEADERS });
  }

  // 6. Build prompt + open Bedrock stream
  const command = new InvokeModelWithResponseStreamCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: MAX_TOKENS,
      system: buildSystemPrompt(version.content),
      messages: [{ role: "user", content: query }],
    }),
  });

  const abortController = new AbortController();
  const onCallerAbort = () => abortController.abort();
  request.signal.addEventListener("abort", onCallerAbort, { once: true });
  const firstTokenTimer = setTimeout(() => abortController.abort(), FIRST_TOKEN_TIMEOUT_MS);

  // 7. Send the command — pre-stream failure path
  let response;
  try {
    response = await bedrockClient.send(command, { abortSignal: abortController.signal });
  } catch (err) {
    clearTimeout(firstTokenTimer);
    request.signal.removeEventListener("abort", onCallerAbort);
    if (abortController.signal.aborted && !request.signal.aborted) {
      status = "timeout";
      errorMessage = "No first token within 30s";
      try {
        return jsonResponse({ error: errorMessage }, 504);
      } finally {
        await writeLog();
      }
    }
    status = "error";
    errorMessage = sanitizeError(err);
    try {
      return jsonResponse({ error: errorMessage }, 502);
    } finally {
      await writeLog();
    }
  }

  if (!response.body) {
    clearTimeout(firstTokenTimer);
    request.signal.removeEventListener("abort", onCallerAbort);
    status = "error";
    errorMessage = "Bedrock returned no body";
    try {
      return jsonResponse({ error: errorMessage }, 502);
    } finally {
      await writeLog();
    }
  }

  // 8. SSE stream — at this point HTTP 200 is committed; mid-stream errors
  //    surface as `event: error`, not as HTTP status.
  const bedrockBody = response.body;
  const fullText: string[] = [];

  const sseStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const decoder = new TextDecoder();
      let firstChunkSeen = false;
      try {
        for await (const event of bedrockBody) {
          if (!event.chunk?.bytes) continue;
          const json = JSON.parse(decoder.decode(event.chunk.bytes));

          if (json.type === "content_block_delta" && json.delta?.type === "text_delta") {
            const text: string = json.delta.text;
            if (!firstChunkSeen) {
              firstChunkSeen = true;
              clearTimeout(firstTokenTimer);
            }
            fullText.push(text);
            controller.enqueue(enc.encode(sseEvent("chunk", { text })));
          } else if (json.type === "message_start" && json.message?.usage) {
            inputTokens = json.message.usage.input_tokens ?? inputTokens;
            outputTokens = json.message.usage.output_tokens ?? outputTokens;
          } else if (json.type === "message_delta" && json.usage) {
            outputTokens = json.usage.output_tokens ?? outputTokens;
          }
        }

        controller.enqueue(
          enc.encode(
            sseEvent("done", {
              input_tokens: inputTokens,
              output_tokens: outputTokens,
              latency_ms: Date.now() - start,
            }),
          ),
        );

        const text = fullText.join("");
        if (text.length > 0) {
          setCached(ck, {
            text,
            input_tokens: inputTokens ?? 0,
            output_tokens: outputTokens ?? 0,
          });
        }
      } catch (err) {
        if (abortController.signal.aborted && !firstChunkSeen && !request.signal.aborted) {
          status = "timeout";
          errorMessage = "No first token within 30s";
        } else {
          status = "error";
          errorMessage = sanitizeError(err);
        }
        try {
          controller.enqueue(enc.encode(sseEvent("error", { message: errorMessage })));
        } catch {
          // controller may already be closed if caller disconnected
        }
      } finally {
        clearTimeout(firstTokenTimer);
        request.signal.removeEventListener("abort", onCallerAbort);
        try {
          controller.close();
        } catch {
          // already closed
        }
        await writeLog();
      }
    },
  });

  return new Response(sseStream, { headers: SSE_HEADERS });
}
