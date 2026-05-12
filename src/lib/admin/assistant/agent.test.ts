import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 5 Stream B (D14.4) — unit coverage for the agent loop.
//
// Three tests:
//   (a) 10-tool-call cap: the agent yields 'error' when toolCallCount > 10.
//   (b) Persistence on success: end_turn → expected prisma.assistantMessage.create calls.
//   (c) Error sanitization: AKIA-tokens are stripped from yielded error messages.

// Typed callable signatures so .mock.calls + the call sites both work
// without the "Procedure | Constructable" union getting in the way.
const prismaCreateMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const prismaUpdateMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const prismaFindManyMock = vi.fn<(arg?: unknown) => Promise<unknown>>();

vi.mock("@/lib/db", () => ({
  prisma: {
    assistantMessage: {
      create: (arg: unknown) => prismaCreateMock(arg),
      findMany: (arg?: unknown) => prismaFindManyMock(arg),
    },
    assistantConversation: {
      update: (arg: unknown) => prismaUpdateMock(arg),
    },
  },
}));

// Mock the tool executor so we don't hit DB. Returns deterministic stub.
const executeToolMock = vi.fn<(name: unknown, input: unknown) => Promise<unknown>>();
vi.mock("./tools", () => ({
  TOOLS: [],
  executeTool: (name: unknown, input: unknown) => executeToolMock(name, input),
}));

// Mock bedrock client. We expose a `setBehavior` knob so each test
// configures the stream() return.
type FakeBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

type FakeBehavior = {
  // Per-iteration scripted response. Each entry corresponds to one call to
  // stream(). After the script is exhausted, default to end_turn empty.
  iterations: Array<{
    deltas?: string[];
    blocks: FakeBlock[];
    stopReason: "end_turn" | "tool_use" | "max_tokens";
    inputTokens?: number;
    outputTokens?: number;
  }>;
  // If set, the first call to bedrock.messages.stream THROWS this error
  // instead of returning a stream. Used by the error-sanitization test.
  throwOnCreate?: Error;
};

let behavior: FakeBehavior = { iterations: [] };
let callCount = 0;

vi.mock("./bedrock-client", () => ({
  ASSISTANT_MODEL_ID: "test-model-id",
  bedrock: {
    messages: {
      stream: (..._args: unknown[]) => {
        if (behavior.throwOnCreate) throw behavior.throwOnCreate;
        const iter = behavior.iterations[callCount] ?? {
          blocks: [{ type: "text" as const, text: "done" }],
          stopReason: "end_turn" as const,
        };
        callCount++;
        const deltas = iter.deltas ?? [];

        // The async-iterable yields raw MessageStreamEvent shapes; we
        // emit content_block_delta { type: 'text_delta' } events for each
        // delta. Anything else is fine to omit — the agent loop only
        // pattern-matches text deltas in the for-await loop.
        async function* asyncIter() {
          for (const d of deltas) {
            yield {
              type: "content_block_delta",
              delta: { type: "text_delta", text: d },
            };
          }
        }
        return {
          [Symbol.asyncIterator]: () => asyncIter(),
          finalMessage: async () => ({
            content: iter.blocks,
            stop_reason: iter.stopReason,
            usage: {
              input_tokens: iter.inputTokens ?? 10,
              output_tokens: iter.outputTokens ?? 20,
            },
          }),
        };
      },
    },
  },
}));

import { runAgent } from "./agent";

beforeEach(() => {
  prismaCreateMock.mockReset();
  prismaCreateMock.mockResolvedValue({});
  prismaUpdateMock.mockReset();
  prismaUpdateMock.mockResolvedValue({});
  prismaFindManyMock.mockReset();
  prismaFindManyMock.mockResolvedValue([]);
  executeToolMock.mockReset();
  executeToolMock.mockResolvedValue({ rows: [], count: 0, capped: false });
  callCount = 0;
  behavior = { iterations: [] };
});

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

describe("runAgent", () => {
  // (a) 10-tool-call cap — every iteration emits one tool_use; cap fires
  // when toolCallCount exceeds 10.
  it("yields 'error' with 'limit' message once the 10-tool-call cap is hit", async () => {
    // Script 12 iterations all returning a single tool_use → forces the
    // agent into a loop. The cap should fire on iteration 11.
    behavior.iterations = Array.from({ length: 12 }).map((_, i) => ({
      blocks: [
        {
          type: "tool_use" as const,
          id: `toolu_${i}`,
          name: "list_users",
          input: {},
        },
      ],
      stopReason: "tool_use" as const,
    }));

    const events = await collect(
      runAgent({
        conversationId: "c1",
        newUserMessage: "test",
        ownerUserId: "u1",
      }),
    );

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect((errorEvent as { type: "error"; message: string }).message).toMatch(/limit/i);
  });

  // (b) Persistence on success — end_turn after 1 tool_use round-trip should
  // produce: user message + tool_use row + tool_result row + assistant text row.
  it("persists user, tool_use, tool_result, and assistant text rows on success", async () => {
    behavior.iterations = [
      // First turn: model issues a tool_use.
      {
        blocks: [
          {
            type: "tool_use" as const,
            id: "toolu_1",
            name: "list_users",
            input: { role: "ADMIN" },
          },
        ],
        stopReason: "tool_use" as const,
      },
      // Second turn: model returns final text answer.
      {
        deltas: ["There are ", "2 admins."],
        blocks: [{ type: "text" as const, text: "There are 2 admins." }],
        stopReason: "end_turn" as const,
      },
    ];

    const events = await collect(
      runAgent({
        conversationId: "c1",
        newUserMessage: "how many admins?",
        ownerUserId: "u1",
      }),
    );

    // The expected sequence of prisma.assistantMessage.create roles:
    //   1. role='user' (the new user message)
    //   2. role='tool_use' (after first turn)
    //   3. role='tool_result' (after executing the tool)
    //   4. role='assistant' (the final text after second turn)
    const createdRoles = prismaCreateMock.mock.calls.map(
      (call) => (call[0] as { data: { role: string } }).data.role,
    );
    expect(createdRoles).toEqual(["user", "tool_use", "tool_result", "assistant"]);

    // And the conversation should hit 'done'.
    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
  });

  // (c) Error sanitization — Bedrock errors with creds-shaped tokens get
  // those tokens stripped before the message reaches the SSE stream.
  it("strips AKIA tokens from yielded error messages", async () => {
    behavior.throwOnCreate = new Error(
      "AWS credentials missing AKIA1234567890ABCDEF — region us-east-1",
    );

    const events = await collect(
      runAgent({
        conversationId: "c1",
        newUserMessage: "hi",
        ownerUserId: "u1",
      }),
    );

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    const message = (errorEvent as { type: "error"; message: string }).message;
    expect(message).not.toContain("AKIA1234567890ABCDEF");
    expect(message).toContain("[REDACTED]");
  });
});
