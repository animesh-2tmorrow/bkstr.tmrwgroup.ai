import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";

// Phase 6 Stream L (D18.1) — webhook handler tests. Covers the four branches
// of the metadata XOR contract:
//   (W-1) bookId only → book-branch INSERT … ON CONFLICT fires; skill branch doesn't
//   (W-2) skillId only → skill-branch INSERT … ON CONFLICT fires; book branch doesn't
//   (W-3) both present → throws (Stripe receives 500 → retries)
//   (W-4) neither present → throws (same)
//
// Mocks Stripe's constructEvent so tests don't compute real signatures, and
// mocks withIdempotency to call the inner handler directly (idempotency is
// covered separately in Phase 3 Stream 3's existing tests).

const constructEventMock = vi.fn<(body: string, sig: string, secret: string) => Stripe.Event>();
vi.mock("@/lib/stripe", () => ({
  stripe: {
    webhooks: {
      constructEvent: (body: string, sig: string, secret: string) =>
        constructEventMock(body, sig, secret),
    },
  },
}));

const executeRawMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("@/lib/db", () => ({
  prisma: {
    $executeRaw: (...args: unknown[]) => executeRawMock(...args),
  },
}));

// Bypass idempotency wrapping for these tests — just run the inner handler
// and surface its return value. The idempotency mechanism itself is covered
// by Stream 3's `withIdempotency` tests.
vi.mock("@/lib/webhooks/idempotency", () => ({
  withIdempotency: async (
    _eventId: string,
    _source: string,
    handler: () => Promise<unknown>,
  ) => {
    try {
      const result = await handler();
      return { status: "processed", result };
    } catch (error) {
      return { status: "error", error };
    }
  },
}));

import { POST } from "./route";

beforeEach(() => {
  constructEventMock.mockReset();
  executeRawMock.mockReset();
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
});

function makeEvent(metadata: Record<string, string | undefined>): Stripe.Event {
  // Strip undefined keys so the metadata object matches Stripe's shape (where
  // missing fields are simply absent, not undefined).
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (typeof v === "string") cleaned[k] = v;
  }
  return {
    id: "evt_test_" + Math.random().toString(36).slice(2, 10),
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_test_" + Math.random().toString(36).slice(2, 10),
        metadata: cleaned,
      } as unknown as Stripe.PaymentIntent,
    },
  } as unknown as Stripe.Event;
}

function buildSignedRequest(): Request {
  // Body content + signature are mocked at the constructEvent boundary so the
  // actual bytes don't matter — we just need a Request shape.
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=stub" },
    body: "{}",
  });
}

const SUBSCRIBER_ID = "11111111-1111-1111-1111-111111111111";
const BOOK_ID = "22222222-2222-2222-2222-222222222222";
const SKILL_ID = "33333333-3333-3333-3333-333333333333";

describe("POST /api/webhooks/stripe — D18.1 metadata branching", () => {
  it("(W-1) bookId only → book-branch raw SQL INSERT fires; skill branch doesn't", async () => {
    constructEventMock.mockReturnValue(
      makeEvent({ subscriber_id: SUBSCRIBER_ID, book_id: BOOK_ID }),
    );
    executeRawMock.mockResolvedValue(1);

    const res = await POST(buildSignedRequest());
    expect(res.status).toBe(200);
    expect(executeRawMock).toHaveBeenCalledOnce();
    // The tagged-template's first arg is a TemplateStringsArray; subsequent args
    // are the interpolated values. Assert the SQL is the book-branch (mentions
    // `book_id`) and that the interpolated values include the subscriber + book
    // UUIDs in the right slots.
    const [strings, ...values] = executeRawMock.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const joined = strings.join(" ");
    expect(joined).toContain("book_id");
    expect(joined).not.toContain("skill_id");
    expect(values).toContain(SUBSCRIBER_ID);
    expect(values).toContain(BOOK_ID);
  });

  it("(W-2) skillId only → skill-branch raw SQL INSERT fires; book branch doesn't", async () => {
    constructEventMock.mockReturnValue(
      makeEvent({ subscriber_id: SUBSCRIBER_ID, skill_id: SKILL_ID }),
    );
    executeRawMock.mockResolvedValue(1);

    const res = await POST(buildSignedRequest());
    expect(res.status).toBe(200);
    expect(executeRawMock).toHaveBeenCalledOnce();
    const [strings, ...values] = executeRawMock.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const joined = strings.join(" ");
    expect(joined).toContain("skill_id");
    expect(joined).not.toContain("book_id");
    expect(values).toContain(SUBSCRIBER_ID);
    expect(values).toContain(SKILL_ID);
  });

  it("(W-3) both book_id and skill_id present → handler throws (Stripe receives 500 for retry); no raw SQL fires", async () => {
    constructEventMock.mockReturnValue(
      makeEvent({ subscriber_id: SUBSCRIBER_ID, book_id: BOOK_ID, skill_id: SKILL_ID }),
    );

    const res = await POST(buildSignedRequest());
    expect(res.status).toBe(500);
    expect(executeRawMock).not.toHaveBeenCalled();
  });

  it("(W-4) neither book_id nor skill_id present → handler throws (Stripe retries); no raw SQL fires", async () => {
    constructEventMock.mockReturnValue(makeEvent({ subscriber_id: SUBSCRIBER_ID }));

    const res = await POST(buildSignedRequest());
    expect(res.status).toBe(500);
    expect(executeRawMock).not.toHaveBeenCalled();
  });
});
