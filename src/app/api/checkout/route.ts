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

  // Phase 6 Stream L (D18.1) — accept either { book_id } (Stream 3 / books)
  // OR { skill_id } (Stream L / skills). Exactly one must be present. Backward-
  // compatible: existing books callers continue to send { book_id } and hit
  // the book branch unchanged. Kind is implicit from which id field is sent.
  const bookIdRaw = (body as { book_id?: unknown })?.book_id;
  const skillIdRaw = (body as { skill_id?: unknown })?.skill_id;
  const bookId = typeof bookIdRaw === "string" ? bookIdRaw : undefined;
  const skillId = typeof skillIdRaw === "string" ? skillIdRaw : undefined;

  if (bookId && skillId) {
    return NextResponse.json(
      { error: "Specify exactly one of book_id or skill_id, not both" },
      { status: 400 },
    );
  }
  if (!bookId && !skillId) {
    return NextResponse.json(
      { error: "book_id or skill_id is required (UUID string)" },
      { status: 400 },
    );
  }
  const targetId = (bookId ?? skillId)!;
  if (!UUID_REGEX.test(targetId)) {
    return NextResponse.json(
      { error: `${bookId ? "book_id" : "skill_id"} must be a UUID string` },
      { status: 400 },
    );
  }
  const kind: "book" | "skill" = bookId ? "book" : "skill";

  // Resolve subscriber via the user→subscriber 1:1 relation (D1.3).
  const subscriber = await prisma.subscriber.findFirst({
    where: { user: { email: session.user.email } },
    select: { id: true },
  });
  if (!subscriber) {
    return NextResponse.json({ error: "No subscriber for current user" }, { status: 404 });
  }

  // Resolve target + its Stripe Price ID. Books query books + book_prices;
  // skills query skills + skill_prices.
  let stripePriceId: string | null = null;
  let entitySlug: string | null = null;

  if (kind === "book") {
    const book = await prisma.book.findUnique({
      where: { id: targetId },
      select: { id: true, slug: true },
    });
    if (!book) {
      return NextResponse.json({ error: "Book not found" }, { status: 404 });
    }
    const price = await prisma.bookPrice.findFirst({
      where: { bookId: targetId, currency: "USD" },
      select: { stripePriceId: true },
    });
    if (!price) {
      return NextResponse.json({ error: "Book is not for sale (no BookPrice row)" }, { status: 404 });
    }
    stripePriceId = price.stripePriceId;
    entitySlug = book.slug;
  } else {
    const skill = await prisma.skill.findUnique({
      where: { id: targetId },
      select: { id: true, slug: true },
    });
    if (!skill) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }
    const price = await prisma.skillPrice.findFirst({
      where: { skillId: targetId, currency: "USD" },
      select: { stripePriceId: true },
    });
    if (!price) {
      return NextResponse.json({ error: "Skill is not for sale (no SkillPrice row)" }, { status: 404 });
    }
    stripePriceId = price.stripePriceId;
    entitySlug = skill.slug;
  }
  if (!stripePriceId) {
    return NextResponse.json(
      {
        error: `${kind === "book" ? "Book" : "Skill"} has a price but no Stripe Price ID — operator must run pricing sync`,
      },
      { status: 503 },
    );
  }

  // CC-2 / D10.2: any active grant blocks Checkout creation, regardless of
  // source (SEED, MANUAL, SUBSCRIPTION, or prior PURCHASE all trigger 409).
  // Stream L: branch the where filter on kind so book/skill grants are checked
  // against the right id column.
  const existingGrant = await prisma.accessGrant.findFirst({
    where: {
      subscriberId: subscriber.id,
      ...(kind === "book" ? { bookId: targetId } : { skillId: targetId }),
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
  // book_id / skill_id / subscriber_id from pi.metadata. The webhook's XOR
  // check enforces exactly one of book_id/skill_id at the metadata layer.
  const metadata: Record<string, string> = {
    subscriber_id: subscriber.id,
    ...(kind === "book"
      ? { book_id: targetId, book_slug: entitySlug ?? "" }
      : { skill_id: targetId, skill_slug: entitySlug ?? "" }),
  };
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: stripePriceId, quantity: 1 }],
    metadata,
    payment_intent_data: { metadata },
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
