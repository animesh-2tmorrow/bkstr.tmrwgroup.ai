import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { Role } from "@/generated/prisma/client";

// Phase 3 Stream 3 — pricing sync. Phase 4 Stream B broadens the role gate
// from ADMIN-only to PUBLISHER+ADMIN, and adds a server-side ownership check
// so a PUBLISHER cannot re-price a book they don't own (the lab-repo
// activeWorkspaceId trust-gap parallel — a client-supplied book_id MUST be
// re-validated server-side against the book's publisher_user_id).
//
// Body: { book_id, unit_amount_cents }.
// Flow (the "B3" sync per design):
//   1. Validate input + role.
//   2. Look up the Book; bail if not found. Re-check ownership when role=PUBLISHER.
//   3. Find or create the Stripe Product. We don't store stripe_product_id
//      on Book (CC-3 / D9.7); instead we search by metadata.book_id at sync
//      time. If no Product exists, create one with metadata.book_id=<id>.
//   4. Create a fresh Stripe Price object pinned to that Product. Stripe
//      Prices are immutable — every price change produces a new Price.
//   5. Upsert the local BookPrice row (UNIQUE on (book_id, currency)).
//      Repoints stripePriceId at the new Price; UPDATE-in-place because
//      historical pricing lives in Stripe (D9.7's "Stripe is the system of
//      record" trade-off).

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Phase 4 Stream B — PUBLISHER + ADMIN may operate the pricing surface.
  // SUBSCRIBER is denied. ADMIN bypasses the per-book ownership check below.
  if (session.user.role !== Role.ADMIN && session.user.role !== Role.PUBLISHER) {
    return NextResponse.json({ error: "PUBLISHER or ADMIN role required" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const bookId = (body as { book_id?: unknown })?.book_id;
  const unitAmountCents = (body as { unit_amount_cents?: unknown })?.unit_amount_cents;

  if (typeof bookId !== "string" || !UUID_REGEX.test(bookId)) {
    return NextResponse.json({ error: "book_id must be a UUID string" }, { status: 400 });
  }
  if (
    typeof unitAmountCents !== "number" ||
    !Number.isInteger(unitAmountCents) ||
    unitAmountCents <= 0
  ) {
    return NextResponse.json(
      { error: "unit_amount_cents must be a positive integer" },
      { status: 400 },
    );
  }

  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: { id: true, title: true, publisherUserId: true },
  });
  if (!book) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

  // Phase 4 Stream B — server-side ownership check. ADMIN bypasses; PUBLISHER
  // must own the book. Scenario F — PUBLISHER attempts to set price on a
  // book they don't own (e.g. someone else's seed book) → 403 here.
  // Critical: do NOT trust the client; book.publisherUserId is the source of
  // truth, session.user.id is the caller identity.
  if (
    session.user.role === Role.PUBLISHER &&
    book.publisherUserId !== session.user.id
  ) {
    return NextResponse.json({ error: "Not your book" }, { status: 403 });
  }

  // Step 3 — find or create Stripe Product via metadata.book_id search.
  // We don't store stripe_product_id locally (CC-3) so this search is the
  // authoritative way to dedupe Products across runs.
  const productSearch = await stripe.products.search({
    query: `metadata['book_id']:'${bookId}'`,
    limit: 1,
  });

  const product =
    productSearch.data[0] ??
    (await stripe.products.create({
      name: book.title,
      metadata: { book_id: bookId },
    }));

  // Step 4 — create a new Price object. Stripe Prices are immutable, so
  // every price change creates a new Price (D9.7).
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: unitAmountCents,
    currency: "usd",
  });

  // Step 5 — upsert local BookPrice row. UPDATE-in-place repoints
  // stripePriceId at the new Price; the prior Price is left alive in Stripe
  // (immutable + serves as audit trail per D9.7).
  const bookPrice = await prisma.bookPrice.upsert({
    where: {
      bookId_currency: { bookId, currency: "USD" },
    },
    create: {
      bookId,
      currency: "USD",
      unitAmountCents,
      stripePriceId: price.id,
    },
    update: {
      unitAmountCents,
      stripePriceId: price.id,
    },
    select: {
      id: true,
      bookId: true,
      unitAmountCents: true,
      currency: true,
      stripePriceId: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ bookPrice });
}
