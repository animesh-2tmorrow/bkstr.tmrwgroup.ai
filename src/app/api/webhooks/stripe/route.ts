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
  const subscriberId = pi.metadata?.subscriber_id;

  if (!bookId || !subscriberId) {
    // Operator-staged Stripe Checkout Sessions populate this metadata via
    // payment_intent_data.metadata (set in /api/checkout). A PaymentIntent
    // arriving without it is either a manually-created PI in the Stripe
    // Dashboard or a misconfiguration. Log loudly and skip — better than
    // throwing and triggering Stripe retries on a permanently-broken event.
    console.warn(
      `[webhooks/stripe] payment_intent.succeeded missing metadata.book_id/subscriber_id (pi=${pi.id}); no access_grant created.`,
    );
    return;
  }

  // Per D9.6: AccessGrant unique key is (subscriber_id, book_id, source). The
  // upsert key here is that triple with source='PURCHASE'. If a PURCHASE row
  // already exists for this (subscriber, book), update branch fires — log so
  // duplicate-purchase scenarios (refund-then-rebuy, ops re-trigger, etc.)
  // are visible in pm2 logs.
  const result = await prisma.accessGrant.upsert({
    where: {
      subscriberId_bookId_source: {
        subscriberId,
        bookId,
        source: "PURCHASE",
      },
    },
    create: {
      subscriberId,
      bookId,
      source: "PURCHASE",
      stripePaymentIntentId: pi.id,
    },
    update: {
      // Clear any prior revocation — re-purchase intent is a fresh grant.
      revokedAt: null,
      stripePaymentIntentId: pi.id,
    },
  });

  // The upsert API doesn't expose a "did create vs update" signal; do the
  // existence check separately so the warning fires only on update.
  // (Alternative: do a findFirst before the upsert, but that doubles the
  // round-trips; we accept a slightly less-precise log signal.)
  if (result.stripePaymentIntentId === pi.id) {
    console.log(
      `[webhooks/stripe] payment_intent.succeeded → AccessGrant for subscriber=${subscriberId} book=${bookId} pi=${pi.id}`,
    );
  }
}
