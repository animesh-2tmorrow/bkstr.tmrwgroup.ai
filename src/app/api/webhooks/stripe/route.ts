import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/db";
import { withIdempotency } from "@/lib/webhooks/idempotency";

// Phase 3 Stream 3 — Stripe webhook receiver.
// Per D9.3 this is the first webhook route in the codebase and sets the
// pattern for any future inbound webhook (Stream 2's S3 SNS, etc.). Shape:
//   1. raw body via request.text() — NOT request.json(), because Stripe's
//      signature is over the byte-exact request body and any JSON
//      reserialization breaks verification.
//   2. constructEvent throws on bad signature → 400 (fail-closed).
//   3. withIdempotency wraps the handler so duplicate deliveries short-
//      circuit per D10.1.
//   4. Switch on event.type. payment_intent.succeeded provisions an access
//      grant; default branch logs and ack-200s so Stripe doesn't retry.

// Force Node runtime — `request.text()` works on Edge but the Stripe SDK
// pulls in Node-only crypto for signature verification.
export const runtime = "nodejs";

// Phase 3 Stream 3 doesn't use Edge cache at all, but be explicit since
// the route returns dynamic per-event payloads.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const sig = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    console.warn("[webhooks/stripe] STRIPE_WEBHOOK_SECRET missing — rejecting webhook with 500.");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }
  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  // Read the raw body. Stripe's signature scheme requires byte-exact body.
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "signature verification failed";
    console.warn(`[webhooks/stripe] signature verification failed: ${message}`);
    return NextResponse.json({ error: `Invalid signature: ${message}` }, { status: 400 });
  }

  const outcome = await withIdempotency(event.id, "stripe", async () => {
    switch (event.type) {
      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
        return { handled: true, type: event.type };
      default:
        // Per Stripe's at-least-once delivery model, ack-200 on unhandled
        // events so they don't enter the retry queue. Logged so future
        // observation can reveal which event types we should add handlers for.
        console.log(`[webhooks/stripe] unhandled event type: ${event.type} (id=${event.id})`);
        return { handled: false, type: event.type };
    }
  });

  if (outcome.status === "error") {
    // Return 500 so Stripe retries. The idempotency row carries
    // status='error' + error_message for operator diagnosis.
    const message =
      outcome.error instanceof Error
        ? `${outcome.error.name}: ${outcome.error.message}`
        : String(outcome.error);
    console.error(`[webhooks/stripe] handler error for ${event.type} (id=${event.id}): ${message}`);
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }

  // duplicate or processed — both are 200. Stripe doesn't care which.
  return NextResponse.json({ received: true, status: outcome.status });
}

// ─────────────────────────────────────────────────────────────────────────────
// Event handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handlePaymentIntentSucceeded(pi: Stripe.PaymentIntent): Promise<void> {
  const bookId = pi.metadata?.book_id;
  const skillId = pi.metadata?.skill_id;
  const subscriberId = pi.metadata?.subscriber_id;

  // XOR validation per D18.1 §5: exactly one of book_id / skill_id must be
  // present in the metadata. Both-present is a programmer error in the
  // /api/checkout route's metadata generation — throw so Stripe retries until
  // it's fixed. Neither-present is the legacy "this PI isn't ours" path
  // (manually-created PI in Stripe Dashboard, or pre-Stream-L event before
  // metadata schema landed); throw per dispatch — Stripe retries surface the
  // misconfiguration in the Stripe dashboard for operator follow-up.
  // (Behavior change from Stream K's "log + skip" for the missing-metadata
  // case — see commit message.)
  if (bookId && skillId) {
    throw new Error(
      `[webhooks/stripe] payment_intent.succeeded metadata has BOTH book_id and skill_id (pi=${pi.id}) — XOR violation; check /api/checkout metadata generation`,
    );
  }
  if (!bookId && !skillId) {
    throw new Error(
      `[webhooks/stripe] payment_intent.succeeded missing metadata.book_id AND metadata.skill_id (pi=${pi.id}) — no AccessGrant target`,
    );
  }
  if (!subscriberId) {
    throw new Error(
      `[webhooks/stripe] payment_intent.succeeded missing metadata.subscriber_id (pi=${pi.id})`,
    );
  }

  // Per D18.1: the @@unique([subscriberId, bookId, source]) Prisma helper
  // disappeared with the schema change. Two partial unique indexes now enforce
  // uniqueness per content type — book-only on (subscriber_id, book_id, source)
  // WHERE book_id IS NOT NULL, and skill-only on (subscriber_id, skill_id,
  // source) WHERE skill_id IS NOT NULL. We use raw INSERT … ON CONFLICT with
  // the partial-index inference form (Postgres matches by columns + WHERE) so
  // we don't depend on Prisma's generated composite-key helper names (which
  // can vary by version when partial indexes are involved).
  //
  // DO UPDATE preserves the Stream K re-purchase semantic: a buyer who had a
  // grant revoked and then re-pays gets revoked_at cleared. The latest
  // stripe_payment_intent_id is stored so the most recent PI links back.

  if (bookId) {
    await prisma.$executeRaw`
      INSERT INTO access_grants
        (id, subscriber_id, book_id, source, stripe_payment_intent_id, granted_at)
      VALUES
        (gen_random_uuid(), ${subscriberId}::uuid, ${bookId}::uuid, 'PURCHASE'::"GrantSource", ${pi.id}, NOW())
      ON CONFLICT ("subscriber_id", "book_id", "source") WHERE "book_id" IS NOT NULL
      DO UPDATE SET
        revoked_at = NULL,
        stripe_payment_intent_id = EXCLUDED.stripe_payment_intent_id
    `;
    console.log(
      `[webhooks/stripe] payment_intent.succeeded → AccessGrant for subscriber=${subscriberId} book=${bookId} pi=${pi.id}`,
    );
  } else {
    // skillId is non-null by the XOR check above.
    await prisma.$executeRaw`
      INSERT INTO access_grants
        (id, subscriber_id, skill_id, source, stripe_payment_intent_id, granted_at)
      VALUES
        (gen_random_uuid(), ${subscriberId}::uuid, ${skillId}::uuid, 'PURCHASE'::"GrantSource", ${pi.id}, NOW())
      ON CONFLICT ("subscriber_id", "skill_id", "source") WHERE "skill_id" IS NOT NULL
      DO UPDATE SET
        revoked_at = NULL,
        stripe_payment_intent_id = EXCLUDED.stripe_payment_intent_id
    `;
    console.log(
      `[webhooks/stripe] payment_intent.succeeded → AccessGrant for subscriber=${subscriberId} skill=${skillId} pi=${pi.id}`,
    );
  }
}
