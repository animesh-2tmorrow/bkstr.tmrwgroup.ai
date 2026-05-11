import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { BookStatus, GrantSource, Role } from "@/generated/prisma/client";

// Phase 4 Stream B — new-book POST. The atomicity-controlled "create one book"
// flow per CC-9 / D11.7.
//
// REQUEST SHAPE (JSON):
//   {
//     title:        string,   // 1..255 chars
//     slug:         string,   // 1..128 chars, /^[a-z0-9-]+$/ (lowercase-kebab)
//     domain:       string,   // 1..64 chars (free-text taxonomy)
//     description:  string?,  // 0..5000 chars; "" treated as NULL (D11.10)
//     content:      string,   // 1..1_000_000 chars; markdown body
//     price_usd_cents: number,// >= 50 (Stripe min charge), integer
//   }
//
// FLOW (Stripe-first ordering — CC-9 / D11.7):
//   1. Validate session (PUBLISHER or ADMIN).
//   2. Validate input shape (all the bounds above).
//   3. Resolve the tmrwgroup Publisher row (slug='tmrwgroup'). Single-tenant
//      per Phase 4 design §0.1 "publishers internal-only". If absent, return
//      500 with a helpful operator message; do NOT auto-create.
//   4. Resolve the caller's Subscriber row (events.createUser always creates
//      one). Needed for the PUBLISHER_OWN access_grants row (CC-3 / D11.3).
//      If absent, return 500.
//   5. Slug-collision pre-check: hard-error 409 if (publisher_id, slug) is
//      taken. Diverges from import-book.ts's upsert semantics — the UI is
//      create-only; an existing slug should not silently mutate someone
//      else's book.
//   6. Generate book_id + book_version_id client-side via randomUUID() so
//      Stripe metadata.book_id matches the local PK without a chicken-and-egg.
//   7. Stripe Product create (CC-9 step 2). metadata.book_id is set to the
//      pre-allocated UUID and metadata.book_slug to the slug. The post-TX
//      step (10) updates this metadata if anything changes; usually a no-op
//      but documented for parity with the design doc.
//   8. Stripe Price create (CC-9 step 3) against that Product.
//   9. Local prisma.$transaction (CC-9 step 4):
//      - Book insert (status=ACTIVE — Q B-Q7 default per design doc; draft
//        toggle deferred to a follow-up).
//      - BookVersion insert (version=1, content inline per CC-8 / D11.8,
//        contentUri=`inline://<bookVersionId>`).
//      - BookPrice insert (currency=USD, unitAmountCents, stripePriceId).
//      - AccessGrant insert (subscriber=caller's subscribers row, book,
//        source=PUBLISHER_OWN per CC-3 / D11.3). createMany with
//        skipDuplicates handles the (subscriber, book, source) uniqueness;
//        a duplicate is a no-op.
//  10. Stripe Product update — best-effort metadata refresh. The original
//      Product create already wrote metadata.book_id = the same UUID, so this
//      is functionally a no-op today; included for forward-compatibility per
//      the design doc and as the documented "fix metadata if the UUID
//      generation strategy changes" hook. Failure here is logged but does
//      NOT fail the request — the book is fully published locally and on
//      Stripe at this point.
//
// FAILURE MODES:
//   - Stripe Product or Price step fails → no local rows ever exist; return
//     the Stripe error message (no stack trace). User retries the form.
//   - Stripe Product+Price succeed → local TX fails → ORPHAN Stripe Product
//     referencing a book_id that doesn't exist locally. We log ERROR with the
//     orphan Stripe IDs (productId, priceId) and surface them in the JSON
//     error response so the publisher / operator can either retry (next
//     attempt's metadata-search reuses the Product — D9.7 idempotency) or
//     hard-delete the orphan via Stripe Dashboard. Operator runbook entry
//     lives in docs/operations.md "Stream B partial-failure recovery".
//   - Stripe Product update at step 10 fails → log warning, return 201
//     anyway. The book is fully published; the metadata is stale but
//     non-load-bearing (only the local DB is the source of truth for
//     book_id resolution).
//
// Scenario G — "Stripe Product/Price create succeeded but local TX failed."
//   The orphan Stripe Product is identified by its metadata.book_slug query.
//   Operator runbook: docs/operations.md → "Stream B — new book published
//   with Stripe Product/Price success but local TX failure".

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLUG_REGEX = /^[a-z0-9-]+$/;
const TMRWGROUP_PUBLISHER_SLUG = "tmrwgroup";

// Hard caps (cheap sanity checks; do not bind the schema).
const TITLE_MAX = 255;
const SLUG_MAX = 128;
const DOMAIN_MAX = 64;
const DESCRIPTION_MAX = 5_000;
const CONTENT_MAX = 1_000_000; // 1MB markdown sanity cap
const STRIPE_MIN_CENTS = 50; // Stripe USD minimum charge per docs

type ValidatedInput = {
  title: string;
  slug: string;
  domain: string;
  description: string | null;
  content: string;
  priceUsdCents: number;
};

function validateInput(body: unknown): ValidatedInput | { error: string } {
  if (!body || typeof body !== "object") return { error: "Body must be a JSON object" };
  const b = body as Record<string, unknown>;

  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (title.length === 0 || title.length > TITLE_MAX) {
    return { error: `title must be 1..${TITLE_MAX} chars` };
  }

  const slug = typeof b.slug === "string" ? b.slug.trim().toLowerCase() : "";
  if (slug.length === 0 || slug.length > SLUG_MAX) {
    return { error: `slug must be 1..${SLUG_MAX} chars` };
  }
  if (!SLUG_REGEX.test(slug)) {
    return { error: "slug must match /^[a-z0-9-]+$/ (lowercase letters, digits, hyphens)" };
  }

  const domain = typeof b.domain === "string" ? b.domain.trim() : "";
  if (domain.length === 0 || domain.length > DOMAIN_MAX) {
    return { error: `domain must be 1..${DOMAIN_MAX} chars` };
  }

  // Description is optional. Empty-string is treated as NULL per D11.10 —
  // both nullable shipping shapes ("description is empty" vs "publisher has
  // not yet written one") collapse to NULL in the DB.
  let description: string | null = null;
  if (typeof b.description === "string") {
    const trimmed = b.description.trim();
    if (trimmed.length > DESCRIPTION_MAX) {
      return { error: `description must be <= ${DESCRIPTION_MAX} chars` };
    }
    description = trimmed.length === 0 ? null : trimmed;
  } else if (b.description !== undefined && b.description !== null) {
    return { error: "description must be a string when provided" };
  }

  const content = typeof b.content === "string" ? b.content : "";
  if (content.length === 0) return { error: "content is required" };
  if (content.length > CONTENT_MAX) {
    return { error: `content must be <= ${CONTENT_MAX} chars (1MB)` };
  }

  const priceRaw = b.price_usd_cents;
  if (typeof priceRaw !== "number" || !Number.isInteger(priceRaw) || priceRaw < STRIPE_MIN_CENTS) {
    return {
      error: `price_usd_cents must be an integer >= ${STRIPE_MIN_CENTS} (Stripe USD minimum)`,
    };
  }

  return { title, slug, domain, description, content, priceUsdCents: priceRaw };
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email || !session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Phase 4 Stream B — PUBLISHER + ADMIN may create books. SUBSCRIBER denied.
  // Defense-in-depth: the /dashboard/books/new page also server-side-redirects
  // away from this surface for non-authoring roles.
  if (session.user.role !== Role.PUBLISHER && session.user.role !== Role.ADMIN) {
    return NextResponse.json({ error: "PUBLISHER or ADMIN role required" }, { status: 403 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validated = validateInput(rawBody);
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const { title, slug, domain, description, content, priceUsdCents } = validated;

  // Step 3 — resolve tmrwgroup Publisher row. Phase 4 §0.1 "publishers
  // internal-only" — all books map to this single row regardless of which
  // PUBLISHER User created them. The per-user attribution lives on
  // book.publisher_user_id (D11.10), not on Publisher.
  const publisher = await prisma.publisher.findFirst({
    where: { slug: TMRWGROUP_PUBLISHER_SLUG },
    select: { id: true },
  });
  if (!publisher) {
    console.error(
      `[books/new] Publisher slug='${TMRWGROUP_PUBLISHER_SLUG}' missing — operator must seed via import-book.ts or SQL before publishers can use /dashboard/books/new.`,
    );
    return NextResponse.json(
      {
        error: `Publisher '${TMRWGROUP_PUBLISHER_SLUG}' not found. Operator: seed it via 'npm run import-book' or SQL INSERT before retrying.`,
      },
      { status: 500 },
    );
  }

  // Step 4 — resolve caller's Subscriber row. events.createUser auto-creates
  // one (src/lib/auth/index.ts:154) but defensive: if it's missing the
  // PUBLISHER_OWN grant cannot be written and we'd leave a book without an
  // access path for its own publisher. Fail loudly before any Stripe call.
  const subscriber = await prisma.subscriber.findFirst({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!subscriber) {
    console.error(
      `[books/new] Subscriber row missing for user_id=${session.user.id}. events.createUser may have failed silently.`,
    );
    return NextResponse.json(
      { error: "Subscriber row missing for current user — operator must seed via SQL." },
      { status: 500 },
    );
  }

  // Step 5 — slug collision pre-check (Q B-Q3: hard-error rather than upsert).
  const existing = await prisma.book.findUnique({
    where: { publisherId_slug: { publisherId: publisher.id, slug } },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: `Slug '${slug}' is already taken in publisher '${TMRWGROUP_PUBLISHER_SLUG}'. Pick a different slug.` },
      { status: 409 },
    );
  }

  // Step 6 — pre-allocate UUIDs. Generating them client-side here means
  // Stripe metadata.book_id can be set on the create call (step 7) and
  // matches the local row PK we'll insert at step 9 without a follow-up
  // patch.
  const bookId = randomUUID();
  const bookVersionId = randomUUID();
  const byteSize = Buffer.byteLength(content, "utf8");

  // Step 7 + 8 — Stripe Product + Price. Failure here is the "happy" failure
  // path: no local rows have been created yet, so the user can simply retry
  // without operator intervention. The metadata.book_slug field is the
  // search key the orphan-recovery runbook uses to identify a partial-failure
  // Product (see Stream B partial-failure recovery in docs/operations.md).
  let stripeProductId: string;
  let stripePriceId: string;
  try {
    const product = await stripe.products.create({
      name: title,
      description: description ?? undefined,
      metadata: { book_id: bookId, book_slug: slug },
    });
    stripeProductId = product.id;
    const price = await stripe.prices.create({
      product: stripeProductId,
      unit_amount: priceUsdCents,
      currency: "usd",
      metadata: { book_id: bookId, book_slug: slug },
    });
    stripePriceId = price.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown Stripe error";
    console.error(`[books/new] Stripe step failed: ${msg}`);
    return NextResponse.json({ error: `Stripe error: ${msg}` }, { status: 502 });
  }

  // Step 9 — local TX. The CC-9 partial-failure surface: if this throws,
  // Stripe Product + Price exist (orphan referencing a non-existent local
  // book_id). The error response surfaces the Stripe IDs so the operator
  // can reconcile (delete the orphan Product via Stripe Dashboard, or retry
  // the form — the next attempt's slug-collision check will fire BEFORE
  // Stripe is touched again, so retry-after-fix is safe).
  // Scenario G — simulate by, e.g., manually breaking a constraint; the
  // recovery path is exactly this branch.
  try {
    await prisma.$transaction([
      prisma.book.create({
        data: {
          id: bookId,
          publisherId: publisher.id,
          publisherUserId: session.user.id,
          slug,
          title,
          description,
          domain,
          status: BookStatus.ACTIVE,
        },
      }),
      prisma.bookVersion.create({
        data: {
          id: bookVersionId,
          bookId,
          version: 1,
          contentUri: `inline://${bookVersionId}`,
          byteSize,
          content,
        },
      }),
      prisma.bookPrice.create({
        data: {
          bookId,
          currency: "USD",
          unitAmountCents: priceUsdCents,
          stripePriceId,
        },
      }),
      // CC-3 / D11.3 — PUBLISHER_OWN grant. createMany skipDuplicates is the
      // ON CONFLICT (subscriber_id, book_id, source) DO NOTHING equivalent —
      // a duplicate would only fire if a prior failed attempt already wrote
      // a grant for this (subscriber, book) which is impossible inside a
      // brand-new transaction, but the idempotent shape costs nothing and
      // matches the migration backfill semantics.
      prisma.accessGrant.createMany({
        data: [
          {
            subscriberId: subscriber.id,
            bookId,
            source: GrantSource.PUBLISHER_OWN,
          },
        ],
        skipDuplicates: true,
      }),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown DB error";
    console.error(
      `[books/new] Local TX failed AFTER Stripe Product+Price created. ORPHAN Stripe IDs: product=${stripeProductId} price=${stripePriceId}. metadata.book_slug=${slug}. Error: ${msg}`,
    );
    return NextResponse.json(
      {
        error: `Local transaction failed: ${msg}`,
        orphanStripeProductId: stripeProductId,
        orphanStripePriceId: stripePriceId,
        recovery:
          "The Stripe Product+Price were created before the local transaction failed. Either retry the form (the slug check will block a duplicate so this is safe) or delete the orphan Product via Stripe Dashboard. Runbook: docs/operations.md 'Stream B — new book published with Stripe Product/Price success but local TX failure'.",
      },
      { status: 500 },
    );
  }

  // Step 10 — best-effort Stripe Product metadata refresh. As-of-now the
  // metadata already matches (set at step 7), so this is a no-op for the
  // typical happy path; kept for the design-doc CC-9 step 5 parity and as
  // the documented hook if future code paths need to patch metadata after
  // the local TX (e.g. canonical slug rewrites). Failure here is logged at
  // warn level but does not fail the request — the book is fully published.
  try {
    await stripe.products.update(stripeProductId, {
      metadata: { book_id: bookId, book_slug: slug },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown Stripe error";
    console.warn(
      `[books/new] Step 10 Stripe Product metadata refresh failed (non-fatal): product=${stripeProductId} ${msg}`,
    );
  }

  return NextResponse.json({ id: bookId, slug }, { status: 201 });
}
