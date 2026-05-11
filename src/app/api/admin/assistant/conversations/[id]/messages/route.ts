import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Role } from "@/generated/prisma/client";
import { runAgent, type AgentEvent } from "@/lib/admin/assistant/agent";

// Phase 5 Stream B — GET: list messages in a conversation. POST: append a
// new user message, run the agent, stream response events as SSE.
// ADMIN-only + ownership-checked on both.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_LEN = 8000;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
} as const;

// Mirrors src/app/api/agent/fetch/route.ts:44 — `event: <name>\ndata: <json>\n\n`.
function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function requireOwnedConversation(
  conversationId: string,
  userId: string,
): Promise<
  | { ok: true }
  | { ok: false; status: number; error: string }
> {
  if (!UUID_REGEX.test(conversationId)) {
    return { ok: false, status: 400, error: "Conversation id must be a UUID" };
  }
  const conv = await prisma.assistantConversation.findUnique({
    where: { id: conversationId },
    select: { ownerUserId: true, archivedAt: true },
  });
  if (!conv) {
    return { ok: false, status: 404, error: "Conversation not found" };
  }
  if (conv.ownerUserId !== userId) {
    return { ok: false, status: 403, error: "You do not own this conversation" };
  }
  if (conv.archivedAt) {
    return {
      ok: false,
      status: 410,
      error: "Conversation is archived — start a new one",
    };
  }
  return { ok: true };
}

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== Role.ADMIN) {
    return NextResponse.json({ error: "ADMIN role required" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const check = await requireOwnedConversation(id, session.user.id);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const rows = await prisma.assistantMessage.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true, createdAt: true },
  });

  return NextResponse.json(rows, { status: 200 });
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== Role.ADMIN) {
    return NextResponse.json({ error: "ADMIN role required" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const check = await requireOwnedConversation(id, session.user.id);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const content = (body as { content?: unknown }).content;
  if (typeof content !== "string" || content.length === 0) {
    return NextResponse.json(
      { error: "content required (non-empty string)" },
      { status: 400 },
    );
  }
  if (content.length > MAX_MESSAGE_LEN) {
    return NextResponse.json(
      { error: `content exceeds ${MAX_MESSAGE_LEN} chars` },
      { status: 400 },
    );
  }

  const ownerUserId = session.user.id;
  const conversationId = id;

  // Mirror the SSE ReadableStream shape at src/app/api/agent/fetch/route.ts:277-345.
  // The runAgent generator is the source-of-truth for event ordering;
  // this wrapper just re-encodes events as SSE frames.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      try {
        for await (const event of runAgent({
          conversationId,
          newUserMessage: content,
          ownerUserId,
        })) {
          controller.enqueue(enc.encode(sseEvent(event.type, eventPayload(event))));
        }
      } catch (err) {
        // runAgent already catches and yields 'error' for normal failures;
        // this branch only fires if the generator itself throws (e.g. DB
        // disconnect mid-iteration). Best-effort send + close.
        console.error("[assistant/messages] stream consumer error:", err);
        try {
          controller.enqueue(
            enc.encode(sseEvent("error", { message: "Internal error" })),
          );
        } catch {
          // controller may already be closed
        }
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

// Strip the discriminator before serializing — the client gets `data` =
// the event-specific payload only, with `event:` line giving the type.
function eventPayload(e: AgentEvent): Record<string, unknown> {
  switch (e.type) {
    case "text_delta":
      return { delta: e.delta };
    case "tool_use_start":
      return { toolUseId: e.toolUseId, name: e.name, input: e.input };
    case "tool_use_result":
      return { toolUseId: e.toolUseId, output: e.output };
    case "done":
      return { inputTokens: e.inputTokens, outputTokens: e.outputTokens };
    case "error":
      return { message: e.message };
  }
}
