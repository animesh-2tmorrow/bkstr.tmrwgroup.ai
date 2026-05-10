import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";

// Phase 3 Stream 3 — Checkout Session creator.
// Hosted Checkout per design OQ-2 (Stripe-hosted page; we don't take card
// details ourselves). Caller posts { book_id }; we resolve subscriber from
// session, look up the book + its BookPrice row, **reject with 409 if any
// active access_grant exists for (subscriber, book) regardless of source**
// (CC-2 / D10.2), then create a mode='payment' Session with the Stripe
// price_id from BookPrice.stripePriceId.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const bookId = (body as { book_id?: unknown })?.book_id;
  if (typeof bookId !== "string" || !UUID_REGEX.test(bookId)) {
    return NextResponse.json({ error: "book_id must be a UUID string" }, { status: 400 });
  }

  // Resolve subscriber via the user→subscriber 1:1 relation (D1.3).
  const subscriber = await prisma.subscriber.findFirst({
    where: { user: { email: session.user.email } },
    select: { id: true },
  });
  if (!subscriber) {
    return NextResponse.json({ error: "No subscriber for current user" }, { status: 404 });
  }

  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: { id: true, title: true },
  });
  if (!book) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

  const price = await prisma.bookPrice.findFirst({
    where: { bookId, currency: "USD" },
    select: { unitAmountCents: true, stripePriceId: true, currency: true },
  });
  if (!price) {
    return NextResponse.json({ error: "Book is not for sale (no BookPrice row)" }, { status: 404 });
  }
  if (!price.stripePriceId) {
    return NextResponse.json(
      { error: "Book has a price but no Stripe Price ID — operator must run pricing sync" },
      { status: 503 },
    );
  }

  // CC-2 / D10.2: any active grant blocks Checkout creation, regardless of
  // source (SEED, MANUAL, SUBSCRIPTION, or prior PURCHASE all trigger 409).
  // The unique constraint is (subscriber, book, source), so multiple sources
  // can coexist — we reject on the existence of any non-revoked row.
  const existingGrant = await prisma.accessGrant.findFirst({
    where: {
      subscriberId: subscriber.id,
      bookId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true, source: true },
  });
  if (existingGrant) {
    return NextResponse.json(
      {
        error: "Access already granted",
        source: existingGrant.source,
      },
      { status: 409 },
    );
  }

  // Build the Checkout Session. metadata is duplicated into payment_intent_data
  // because the webhook receives a PaymentIntent (not a Session) and reads
  // book_id / subscriber_id from pi.metadata.
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: price.stripePriceId, quantity: 1 }],
    metadata: {
      book_id: bookId,
      subscriber_id: subscriber.id,
    },
    payment_intent_data: {
      metadata: {
        book_id: bookId,
        subscriber_id: subscriber.id,
      },
    },
    customer_email: session.user.email,
    success_url: `${baseUrl}/dashboard/purchase/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/dashboard`,
  });

  if (!checkoutSession.url) {
    console.error(
      `[checkout] Stripe returned a session without a URL (id=${checkoutSession.id}); aborting.`,
    );
    return NextResponse.json({ error: "Stripe session creation failed" }, { status: 502 });
  }

  return NextResponse.json({ url: checkoutSession.url });
}
