import { Prisma, Role, type GrantSource } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
// redesign(10) Phase 1 — used by the new unified-catalog query helpers
// appended at the bottom of this file. Import-at-top keeps ES module
// semantics happy (mid-file imports are syntax errors).
import type { BookCoverPalette } from "@/components/design/book-cover";
import type { StorefrontKind } from "@/lib/storefront/resolve-slug";

export type BookWithMetrics = {
  id: string;
  title: string;
  slug: string;
  domain: string;
  // PR 8 — typographic cover drivers. `palette` is one of
  // saffron|forest|oxblood|indigo|plum|slate; `glyph` is a single
  // uppercase ASCII letter ('?' for non-alpha titles). Threaded through
  // to the books-table SVG cover render. See prisma/schema.prisma Book
  // model for the columns and migration 20260515090000 for the backfill.
  palette: string;
  glyph: string;
  latestVersion: number;
  totalFetches: number;
  fetches30d: number;
  activeAgents30d: number;
  lastFetchedAt: Date | null;
};

// Phase 3 Stream 3 — per-subscriber access state for the Books table.
// Computed by joining BookPrice + AccessGrant for the current subscriber.
// `state` is the rendered status: "granted" if any active grant exists
// (regardless of source — matches CC-2 / D10.2's checkout-block rule),
// "for_sale" if a BookPrice row + Stripe Price exist and no grant,
// "not_for_sale" otherwise.
export type BookAccessState = {
  bookId: string;
  state: "granted" | "for_sale" | "not_for_sale";
  unitAmountCents: number | null;
  stripePriceId: string | null;
  grantSource: string | null;
};

// Single aggregate query — books + version max + cross-subscriber fetch
// metrics in one round-trip. LEFT JOINs so books with zero versions or
// zero fetches still appear with zeros. COUNT cast to int (4-byte) is
// fine at any realistic Phase 2/3 row count and avoids bigint marshaling.
//
// Per D6.8 single-tenant scope, no WHERE clause for publisher/subscriber —
// the Books table shows every book in the system. Phase 3's split into
// publisher and subscriber dashboards (#39) will add scope filters.
export async function getBooksWithMetrics(): Promise<BookWithMetrics[]> {
  type Row = {
    id: string;
    title: string;
    slug: string;
    domain: string;
    palette: string;
    glyph: string;
    latest_version: number;
    total_fetches: number;
    fetches_30d: number;
    active_agents_30d: number;
    last_fetched_at: Date | null;
  };
  // PR 8 — palette + glyph join the SELECT and the GROUP BY. Both are
  // scalar columns on `books`, not aggregated, so they appear in GROUP BY
  // for Postgres's "every non-aggregate must be in GROUP BY" rule.
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT
      b.id::text                                                                          AS id,
      b.title                                                                             AS title,
      b.slug                                                                              AS slug,
      b.domain                                                                            AS domain,
      b.palette                                                                           AS palette,
      b.glyph                                                                             AS glyph,
      COALESCE(MAX(bv.version), 0)::int                                                   AS latest_version,
      COUNT(fl.id)::int                                                                   AS total_fetches,
      COUNT(fl.id) FILTER (WHERE fl.created_at > NOW() - INTERVAL '30 days')::int         AS fetches_30d,
      COUNT(DISTINCT fl.api_key_id)
        FILTER (WHERE fl.created_at > NOW() - INTERVAL '30 days')::int                    AS active_agents_30d,
      MAX(fl.created_at)                                                                  AS last_fetched_at
    FROM books b
    LEFT JOIN book_versions bv ON bv.book_id = b.id
    LEFT JOIN fetch_logs fl    ON fl.book_version_id = bv.id
    GROUP BY b.id, b.title, b.slug, b.domain, b.palette, b.glyph
    ORDER BY b.title
  `);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    domain: r.domain,
    palette: r.palette,
    glyph: r.glyph,
    latestVersion: r.latest_version,
    totalFetches: r.total_fetches,
    fetches30d: r.fetches_30d,
    activeAgents30d: r.active_agents_30d,
    lastFetchedAt: r.last_fetched_at,
  }));
}

// bkstr redesign PR 3 — per-book daily fetch counts for the Active Books
// table sparkline column. 14-day window, zero-filled bucket array per book.
//
// Returns a Map<bookId, number[]>. Length always 14, index 0 = 13 days ago,
// index 13 = today. Books with zero fetches in the window aren't in the
// map — caller should fall back to a zero-array. Book IDs are uuid strings.
export async function getBooksFetchSparklines(): Promise<Map<string, number[]>> {
  type Row = { book_id: string; bucket: Date; count: number };
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT
      bv.book_id::text                                          AS book_id,
      DATE_TRUNC('day', fl.created_at)                          AS bucket,
      COUNT(*)::int                                             AS count
    FROM fetch_logs fl
    JOIN book_versions bv ON bv.id = fl.book_version_id
    WHERE fl.created_at > NOW() - INTERVAL '14 days'
    GROUP BY bv.book_id, DATE_TRUNC('day', fl.created_at)
    ORDER BY bv.book_id, bucket
  `);

  // Bucket-by-day reference: index 0 = 13 days ago, index 13 = today (UTC).
  // Use UTC to match Postgres DATE_TRUNC's TZ — the dashboard renders
  // server-side anyway so client TZ doesn't enter the picture.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const dayMs = 86_400_000;
  const dayIndex = (d: Date): number => {
    const dt = new Date(d);
    dt.setUTCHours(0, 0, 0, 0);
    return 13 - Math.floor((today.getTime() - dt.getTime()) / dayMs);
  };

  const result = new Map<string, number[]>();
  for (const r of rows) {
    const idx = dayIndex(r.bucket);
    if (idx < 0 || idx > 13) continue;
    let bucket = result.get(r.book_id);
    if (!bucket) {
      bucket = Array<number>(14).fill(0);
      result.set(r.book_id, bucket);
    }
    bucket[idx] = r.count;
  }
  return result;
}

// bkstr redesign PR 3 — single-row dashboard summary stats for the
// Active Books page's 4-stat strip. Computed server-side in one
// round-trip; numbers are scoped to the current subscriber when given.
//
// volumesOwned: count of distinct books with an active grant for this
//   subscriber.
// fetches30d:   sum of all fetch_logs by THIS subscriber's api keys in
//   the last 30 days.
// activeAgents30d: count of distinct subscriber_api_keys.id used in
//   fetch_logs in the last 30 days. (Distinct, not summed per book —
//   prevents double-counting across books a single key reads.)
// tokensServed30d: sum of fetch_logs.output_tokens in the last 30 days.
//   NULL output_tokens (failed fetches, pre-instrumentation rows) treated
//   as zero via COALESCE.
export type DashboardStats = {
  volumesOwned: number;
  fetches30d: number;
  activeAgents30d: number;
  tokensServed30d: number;
};

export async function getDashboardStats(
  subscriberId: string,
): Promise<DashboardStats> {
  type StatsRow = {
    volumes_owned: number;
    fetches_30d: number;
    active_agents_30d: number;
    tokens_served_30d: number;
  };
  // Two CTEs joined via cross product into a single row. The CTE shape
  // keeps each metric's WHERE clause readable; the join is just (1,1).
  const rows = await prisma.$queryRaw<StatsRow[]>(Prisma.sql`
    WITH owned AS (
      SELECT COUNT(DISTINCT book_id)::int AS n
      FROM access_grants
      WHERE subscriber_id = ${subscriberId}::uuid
        AND book_id IS NOT NULL
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > NOW())
    ),
    fl_30d AS (
      SELECT
        COUNT(*)::int                                                     AS fetches,
        COUNT(DISTINCT fl.api_key_id)::int                                AS agents,
        COALESCE(SUM(fl.output_tokens), 0)::int                           AS tokens
      FROM fetch_logs fl
      JOIN subscriber_api_keys k ON k.id = fl.api_key_id
      WHERE k.subscriber_id = ${subscriberId}::uuid
        AND fl.created_at > NOW() - INTERVAL '30 days'
    )
    SELECT
      owned.n             AS volumes_owned,
      fl_30d.fetches      AS fetches_30d,
      fl_30d.agents       AS active_agents_30d,
      fl_30d.tokens       AS tokens_served_30d
    FROM owned, fl_30d
  `);
  const r = rows[0] ?? {
    volumes_owned: 0,
    fetches_30d: 0,
    active_agents_30d: 0,
    tokens_served_30d: 0,
  };
  return {
    volumesOwned: r.volumes_owned,
    fetches30d: r.fetches_30d,
    activeAgents30d: r.active_agents_30d,
    tokensServed30d: r.tokens_served_30d,
  };
}

// bkstr redesign PR 3 — billing page's 4-stat strip data.
// All amounts are USD cents (integer) — caller formats. Lifetime spend
// sums the unit_amount on each PURCHASE grant (joined to BookPrice).
// Refunds-available approximates "purchased within the last 14 days" per
// HANDOFF.md pricing-critical: "Refunds within 14 days." Effective per-
// fetch is lifetime spend / total fetches (NOT 30-day) — caller decides
// the format and division-by-zero policy.
export type BillingStats = {
  volumesOwned: number;
  lifetimeSpendCents: number;
  totalFetches: number;
  refundsAvailableCents: number;
  refundsAvailableCount: number;
};

export async function getBillingStats(
  subscriberId: string,
): Promise<BillingStats> {
  type StatsRow = {
    volumes_owned: number;
    lifetime_spend_cents: number;
    total_fetches: number;
    refunds_available_cents: number;
    refunds_available_count: number;
  };
  // Same CTE pattern as getDashboardStats. Lifetime spend joins
  // access_grants → book_prices on (book_id, currency='USD'). PURCHASE
  // source only — operator-issued MANUAL/SEED + PUBLISHER_OWN are not
  // billable line items.
  const rows = await prisma.$queryRaw<StatsRow[]>(Prisma.sql`
    WITH purchases AS (
      SELECT
        ag.id,
        ag.granted_at,
        bp.unit_amount_cents
      FROM access_grants ag
      LEFT JOIN book_prices bp
        ON bp.book_id = ag.book_id AND bp.currency = 'USD'
      WHERE ag.subscriber_id = ${subscriberId}::uuid
        AND ag.source = 'PURCHASE'
        AND ag.revoked_at IS NULL
    ),
    spend AS (
      SELECT
        COUNT(*)::int                                          AS volumes_owned,
        COALESCE(SUM(unit_amount_cents), 0)::int               AS lifetime_spend_cents
      FROM purchases
    ),
    refundable AS (
      SELECT
        COALESCE(SUM(unit_amount_cents), 0)::int               AS amount_cents,
        COUNT(*)::int                                          AS n
      FROM purchases
      WHERE granted_at > NOW() - INTERVAL '14 days'
    ),
    fetches AS (
      SELECT COUNT(*)::int AS n
      FROM fetch_logs fl
      JOIN subscriber_api_keys k ON k.id = fl.api_key_id
      WHERE k.subscriber_id = ${subscriberId}::uuid
    )
    SELECT
      spend.volumes_owned                AS volumes_owned,
      spend.lifetime_spend_cents         AS lifetime_spend_cents,
      fetches.n                          AS total_fetches,
      refundable.amount_cents            AS refunds_available_cents,
      refundable.n                       AS refunds_available_count
    FROM spend, refundable, fetches
  `);
  const r = rows[0] ?? {
    volumes_owned: 0,
    lifetime_spend_cents: 0,
    total_fetches: 0,
    refunds_available_cents: 0,
    refunds_available_count: 0,
  };
  return {
    volumesOwned: r.volumes_owned,
    lifetimeSpendCents: r.lifetime_spend_cents,
    totalFetches: r.total_fetches,
    refundsAvailableCents: r.refunds_available_cents,
    refundsAvailableCount: r.refunds_available_count,
  };
}

export type FetchLogRow = {
  id: string;
  createdAt: Date;
  status: string;
  query: string;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  bookId: string;
  bookTitle: string;
  bookVersion: number;
};

// Per D6.8: fetch logs scoped to the current user's subscriber via the
// user→subscriber relation. Optional bookId narrows further.
// Hard cap at 100 rows; pagination is #35.
export async function getRecentFetchLogs(opts: {
  subscriberId: string;
  bookId?: string;
  limit?: number;
}): Promise<FetchLogRow[]> {
  const rows = await prisma.fetchLog.findMany({
    where: {
      subscriberId: opts.subscriberId,
      ...(opts.bookId ? { bookVersion: { bookId: opts.bookId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 100,
    select: {
      id: true,
      createdAt: true,
      status: true,
      query: true,
      latencyMs: true,
      inputTokens: true,
      outputTokens: true,
      bookVersion: {
        select: {
          version: true,
          book: { select: { id: true, title: true } },
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    status: r.status,
    query: r.query,
    latencyMs: r.latencyMs,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    bookId: r.bookVersion.book.id,
    bookTitle: r.bookVersion.book.title,
    bookVersion: r.bookVersion.version,
  }));
}

// Phase 3 Stream 3 — per-subscriber access map for the Books table.
// Returns one entry per book the system knows about (matches BooksTable's
// row set). Active grants short-circuit to "granted" regardless of source;
// otherwise BookPrice presence + a non-null stripePriceId determines whether
// the row is purchasable.
//
/**
 * @deprecated redesign(10)/5 — use `getAccessStatesForCatalog(subscriberId)`
 *   instead. That function returns a kind-aware map keyed by `${kind}:${id}`
 *   covering both books and skills, replacing this books-only helper.
 *
 *   This helper is kept (not deleted) because `/dashboard/page.tsx`
 *   (Active Books) still calls it, and Active Books is intentionally
 *   books-only (the fleet-fetch telemetry it surfaces doesn't apply to
 *   skills). When Active Books either retires or grows skill support,
 *   switch the call site to `getAccessStatesForCatalog` and delete this
 *   function. Verified Phase 5: only one live caller.
 */
export async function getBookAccessStates(subscriberId: string): Promise<Map<string, BookAccessState>> {
  const [books, prices, grants] = await Promise.all([
    prisma.book.findMany({ select: { id: true } }),
    prisma.bookPrice.findMany({
      where: { currency: "USD" },
      select: { bookId: true, unitAmountCents: true, stripePriceId: true },
    }),
    prisma.accessGrant.findMany({
      where: {
        subscriberId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { bookId: true, source: true },
    }),
  ]);

  const priceByBook = new Map(prices.map((p) => [p.bookId, p]));
  const grantByBook = new Map(grants.map((g) => [g.bookId, g]));

  const out = new Map<string, BookAccessState>();
  for (const b of books) {
    const grant = grantByBook.get(b.id);
    const price = priceByBook.get(b.id);
    if (grant) {
      out.set(b.id, {
        bookId: b.id,
        state: "granted",
        unitAmountCents: price?.unitAmountCents ?? null,
        stripePriceId: price?.stripePriceId ?? null,
        grantSource: grant.source,
      });
    } else if (price && price.stripePriceId) {
      out.set(b.id, {
        bookId: b.id,
        state: "for_sale",
        unitAmountCents: price.unitAmountCents,
        stripePriceId: price.stripePriceId,
        grantSource: null,
      });
    } else {
      out.set(b.id, {
        bookId: b.id,
        state: "not_for_sale",
        unitAmountCents: price?.unitAmountCents ?? null,
        stripePriceId: price?.stripePriceId ?? null,
        grantSource: null,
      });
    }
  }
  return out;
}

export async function getSubscriberIdForEmail(email: string): Promise<string | null> {
  const sub = await prisma.subscriber.findFirst({
    where: { user: { email } },
    select: { id: true },
  });
  return sub?.id ?? null;
}

export async function getBookTitle(bookId: string): Promise<string | null> {
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: { title: true },
  });
  return book?.title ?? null;
}

// Phase 4 Stream B — pricing surface row shape. The query shape forward-
// includes `description` and `publisherUserId` so Stream C's Library view
// can reuse the same select projection without a second pass. Existing
// fields (id/title/slug/domain/unitAmountCents/stripePriceId/updatedAt)
// mirror the legacy pricing page shape so the form component stays stable.
//
// Phase 5 Stream E (D15.5) — `status` added so the per-row Archive /
// Unarchive button renders the right state at /dashboard/pricing.
export type PricingBookRow = {
  id: string;
  title: string;
  slug: string;
  domain: string;
  status: string;
  description: string | null;
  publisherUserId: string | null;
  unitAmountCents: number | null;
  stripePriceId: string | null;
  updatedAt: string | null;
};

// Phase 4 Stream B — publisher-scoped pricing list (D11.10 / Q B-Q6 ownership
// check). When the caller is a PUBLISHER, only books where
// `publisher_user_id = caller.id` are returned. ADMIN sees every book in the
// system. Defense-in-depth: this filter is also re-applied at the
// /api/pricing POST handler so a tampered client cannot operate on a book it
// doesn't own.
export async function getPricingBooks(user: { id: string; role: Role }): Promise<PricingBookRow[]> {
  const where: Prisma.BookWhereInput =
    user.role === Role.ADMIN ? {} : { publisherUserId: user.id };

  const books = await prisma.book.findMany({
    where,
    select: {
      id: true,
      title: true,
      slug: true,
      domain: true,
      status: true,
      description: true,
      publisherUserId: true,
      prices: {
        where: { currency: "USD" },
        select: { unitAmountCents: true, stripePriceId: true, updatedAt: true },
        take: 1,
      },
    },
    orderBy: { title: "asc" },
  });

  return books.map((b) => ({
    id: b.id,
    title: b.title,
    slug: b.slug,
    domain: b.domain,
    status: b.status,
    description: b.description,
    publisherUserId: b.publisherUserId,
    unitAmountCents: b.prices[0]?.unitAmountCents ?? null,
    stripePriceId: b.prices[0]?.stripePriceId ?? null,
    updatedAt: b.prices[0]?.updatedAt?.toISOString() ?? null,
  }));
}

// Phase 4 Stream C — Library route data shape. Distinct from
// getBooksWithMetrics() because the Library doesn't want fetch metrics
// (Total fetches / 30d / Active agents) cluttering the row — it wants
// description, publisher attribution, and price. Filter ACTIVE only so
// DRAFT/ARCHIVED books don't surface to buyers (Q C-6).
//
// Publisher-name attribution prefers the per-user attribution
// (book.publisherUser.name) when present (Phase 4 Stream A's
// publisher_user_id is staged-NULL for the existing 5 seed books today;
// see #68 + D11.10), falling back to the Publisher tenant name otherwise.
// No pagination: 5 books today, ~25 after the next ~5 publishers onboard.
// TODO(follow-up #69): add cursor-pagination when the row count approaches
// ~50.
export type LibraryBook = {
  id: string;
  title: string;
  slug: string;
  domain: string;
  // PR 8 — typographic cover drivers, threaded through to library-table.
  palette: string;
  glyph: string;
  description: string | null;
  publisherName: string;
};

// Phase 4.5 Stream E — admin users-list row shape (D12.3 / Q-E8).
// Read consumer is `/dashboard/admin/users` (the role-mutation surface). The
// shape pulls every column the table renders in one round-trip:
//   - email / name / role from the User row.
//   - companyName from the 1:1 subscriber row (LEFT JOIN-equivalent via Prisma
//     `subscriber: { select: { companyName: true } }`; a User without a
//     Subscriber row — none today since events.createUser always creates one —
//     surfaces as `companyName: null` and renders "—" in the table).
//   - createdAt from the User row (immutable; insertion timestamp).
//   - lastSigninAt from the Stream H column (D12.3); null for users that have
//     not signed in since the column shipped → renders "—".
export type AdminUserRow = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  companyName: string | null;
  createdAt: Date;
  lastSigninAt: Date | null;
  // Stream F's reassign modal uses this to disable target options without
  // a subscribers row (rare; only fires when auto-subscriber-create on
  // first signin failed). Surfaced here rather than on a separate
  // ReassignableUser shape per the Phase 4.5 cross-stream consolidation
  // call. Stream E's users-table does not render this column.
  hasSubscriber: boolean;
};

export type AdminUsersSortBy = "email" | "created_at" | "last_signin_at";
export type AdminUsersSortDir = "asc" | "desc";

// Phase 4.5 Stream E — admin users-list query (D12.3 / Q-E4 / Q-E7 / Q-E8).
// Returns every user that matches the optional role filter, sorted by the
// caller-supplied (sortBy, sortDir). Default ordering is `last_signin_at DESC
// NULLS LAST` so the most-recently-active operators bubble to the top of the
// table; never-signed-in rows sink to the bottom (where the operator can spot
// them by the "—" in the Last signin column).
//
// No pagination (Q-E7): 3 users today; the prompt defers pagination to a
// follow-up if the user count crosses ~50. Prisma's `findMany` without `take`
// returns every row — at internal-alpha volume this is the right shape.
//
// Read consumer: `app/dashboard/admin/users/page.tsx` (ADMIN-only via the
// layout guard at `app/dashboard/admin/layout.tsx`). The ADMIN-only guard is
// re-checked by the page itself and by the route handler that consumes the
// resulting `id` column for mutations — this query trusts its caller and does
// no role check of its own.
function orderClauseFor(sortBy: AdminUsersSortBy, sortDir: AdminUsersSortDir) {
  // Prisma 7's `{ sort, nulls }` syntax is supported on nullable Date columns
  // (e.g. lastSigninAt). For email + createdAt (both NOT NULL on the row),
  // `nulls` is not applicable; using a plain `Prisma.SortOrder` string is the
  // canonical shape.
  if (sortBy === "last_signin_at") {
    return {
      lastSigninAt: {
        sort: sortDir,
        nulls: sortDir === "desc" ? ("last" as const) : ("first" as const),
      },
    } satisfies Prisma.UserOrderByWithRelationInput;
  }
  if (sortBy === "email") {
    return { email: sortDir } satisfies Prisma.UserOrderByWithRelationInput;
  }
  return { createdAt: sortDir } satisfies Prisma.UserOrderByWithRelationInput;
}

export async function getAdminUsers(opts: {
  // Accepts a single Role (Stream E's users-list filter tabs) or a Role[]
  // (Stream F's reassign modal — `[PUBLISHER, ADMIN]`). Omit for "all roles."
  roleFilter?: Role | Role[];
  sortBy?: AdminUsersSortBy;
  sortDir?: AdminUsersSortDir;
}): Promise<AdminUserRow[]> {
  const where: Prisma.UserWhereInput = opts.roleFilter
    ? Array.isArray(opts.roleFilter)
      ? { role: { in: opts.roleFilter } }
      : { role: opts.roleFilter }
    : {};
  const orderBy = orderClauseFor(opts.sortBy ?? "last_signin_at", opts.sortDir ?? "desc");

  const users = await prisma.user.findMany({
    where,
    orderBy,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      lastSigninAt: true,
      subscriber: { select: { id: true, companyName: true } },
    },
  });

  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    companyName: u.subscriber?.companyName ?? null,
    createdAt: u.createdAt,
    lastSigninAt: u.lastSigninAt,
    hasSubscriber: u.subscriber !== null,
  }));
}

/**
 * @deprecated redesign(10)/5 — use `getCatalogForLibrary()` instead. That
 *   function returns a kind-aware `LibraryItem[]` covering both books and
 *   skills, replacing this books-only helper.
 *
 *   This helper is kept (not deleted) because it lives in the same legacy
 *   pair as `getBookAccessStates`, which `/dashboard/page.tsx` still calls.
 *   Verified Phase 5: zero live callers of THIS function (the Library page
 *   migrated to `getCatalogForLibrary` in Phase 3), but the deprecation
 *   note pairs it with its sibling so a future cleanup deletes both
 *   together.
 */
export async function getBooksForLibrary(): Promise<LibraryBook[]> {
  const rows = await prisma.book.findMany({
    where: { status: "ACTIVE" },
    orderBy: { title: "asc" },
    select: {
      id: true,
      title: true,
      slug: true,
      domain: true,
      palette: true,
      glyph: true,
      description: true,
      publisher: { select: { name: true } },
      publisherUser: { select: { name: true } },
    },
  });
  return rows.map((b) => ({
    id: b.id,
    title: b.title,
    slug: b.slug,
    domain: b.domain,
    palette: b.palette,
    glyph: b.glyph,
    description: b.description,
    // Per-user attribution wins when present; tenant Publisher name is the
    // staged-NULL fallback. Edge case: publisherUser.name itself may be NULL
    // on a Google account without a profile name — collapse to the tenant
    // name in that case too.
    publisherName:
      (b.publisherUser?.name && b.publisherUser.name.trim().length > 0
        ? b.publisherUser.name
        : null) ?? b.publisher.name,
  }));
}

// Phase 4.5 Stream F (D12.13) — ADMIN-scoped book ledger for
// /dashboard/admin/books. Joins both the per-user publisher attribution
// (Phase 4 D11.10) AND the tenant Publisher row so the table can render
// "publisherUser.name → publisher.name" with the user's email as a
// disambiguating subtitle (matches Stream F brief §4). USD price comes from
// the same prices[0] take-1 shape as getPricingBooks (currency="USD" filter
// + take 1, the BookPrice unique key is (bookId, currency) so this is
// effectively a single-row lookup). The activeGrantCount column reads
// `_count.accessGrants` with a where-filter for `revokedAt IS NULL` — Prisma
// supports filtered _count via the relation-load.
//
// No role-filter — ADMIN sees every book. The query is one round-trip per
// table render; the layout gate (auth() role === ADMIN) means this only
// runs for ADMIN sessions.
export type AdminBookRow = {
  id: string;
  title: string;
  slug: string;
  domain: string;
  status: string;
  publisherTenantName: string;
  publisherUserId: string | null;
  publisherUserName: string | null;
  publisherUserEmail: string | null;
  unitAmountCents: number | null;
  activeGrantCount: number;
};

export async function getAdminBooks(): Promise<AdminBookRow[]> {
  const books = await prisma.book.findMany({
    orderBy: { title: "asc" },
    select: {
      id: true,
      title: true,
      slug: true,
      domain: true,
      status: true,
      publisherUserId: true,
      publisher: { select: { name: true } },
      publisherUser: { select: { name: true, email: true } },
      prices: {
        where: { currency: "USD" },
        select: { unitAmountCents: true },
        take: 1,
      },
      _count: {
        select: {
          accessGrants: { where: { revokedAt: null } },
        },
      },
    },
  });

  return books.map((b) => ({
    id: b.id,
    title: b.title,
    slug: b.slug,
    domain: b.domain,
    status: b.status,
    publisherTenantName: b.publisher.name,
    publisherUserId: b.publisherUserId,
    publisherUserName: b.publisherUser?.name ?? null,
    publisherUserEmail: b.publisherUser?.email ?? null,
    unitAmountCents: b.prices[0]?.unitAmountCents ?? null,
    activeGrantCount: b._count.accessGrants,
  }));
}

// Phase 4.5 Stream F — pool of users eligible to be a book's publisher.
// Phase 4.5 Stream F — full access_grants ledger for /dashboard/admin/grants.
// Filterable via search params: ?source / ?subscriber / ?book. Each filter
// is single-select per Q-F4 (matches Stream E's tabs pattern). Joins
// subscriber + book so the table can render subscriber email + book title
// inline.
// Phase 6 Stream L (D18.1) — AccessGrant becomes polymorphic over Book/Skill
// (XOR-checked at the DB layer). The admin grants ledger renders either; rows
// carry both bookId+skill fields (one set non-null, the other null), and the
// table component shows the populated title/name with a Book/Skill badge.
export type AdminGrantRow = {
  id: string;
  source: GrantSource;
  subscriberId: string;
  subscriberEmail: string;
  // Stream V (D19.x) — exposed for the modal's self-protection soft rail.
  // Compared against the current admin's session.user.id; equality + source
  // === PUBLISHER_OWN triggers the typed-email confirmation block. Nullable
  // because Subscriber.userId is nullable (legacy rows with no linked user).
  subscriberUserId: string | null;
  bookId: string | null;
  bookTitle: string | null;
  bookSlug: string | null;
  skillId: string | null;
  skillName: string | null;
  skillSlug: string | null;
  grantedAt: Date;
  revokedAt: Date | null;
  expiresAt: Date | null;
};

export async function getAdminGrants(opts: {
  source?: GrantSource;
  subscriberId?: string;
  bookId?: string;
  skillId?: string;
}): Promise<AdminGrantRow[]> {
  // Build the where clause from optional filters — undefined keys are
  // dropped by Prisma so the no-filter call returns every grant row.
  const where: Prisma.AccessGrantWhereInput = {};
  if (opts.source) where.source = opts.source;
  if (opts.subscriberId) where.subscriberId = opts.subscriberId;
  if (opts.bookId) where.bookId = opts.bookId;
  if (opts.skillId) where.skillId = opts.skillId;

  const grants = await prisma.accessGrant.findMany({
    where,
    // Active grants first (revoked_at NULL), then most-recently-granted —
    // matches "most operationally interesting at the top." NULLS FIRST is
    // the implicit Postgres default for ASC; we want NULL revokedAt at the
    // top, then chronological among revoked.
    orderBy: [{ revokedAt: "asc" }, { grantedAt: "desc" }],
    select: {
      id: true,
      source: true,
      subscriberId: true,
      bookId: true,
      skillId: true,
      grantedAt: true,
      revokedAt: true,
      expiresAt: true,
      subscriber: {
        select: {
          email: true,
          // The subscribers.email column is the canonical address; the
          // join-back to users is only needed for cases where subscribers.email
          // is empty (rare; PrismaAdapter copies user.email into the
          // subscriber row at signin per src/lib/auth/index.ts:154).
          // Stream V (D19.x) — also pull user.id so the row can carry
          // subscriberUserId for the modal's self-protection comparison.
          user: { select: { id: true, email: true } },
        },
      },
      book: { select: { title: true, slug: true } },
      skill: { select: { name: true, slug: true } },
    },
  });

  return grants.map((g) => ({
    id: g.id,
    source: g.source,
    subscriberId: g.subscriberId,
    subscriberEmail: g.subscriber.email || g.subscriber.user?.email || "—",
    // Stream V (D19.x) — exposed for the revoke modal's self-protection
    // soft rail. Null when the subscriber has no linked user row.
    subscriberUserId: g.subscriber.user?.id ?? null,
    bookId: g.bookId,
    bookTitle: g.book?.title ?? null,
    bookSlug: g.book?.slug ?? null,
    skillId: g.skillId,
    skillName: g.skill?.name ?? null,
    skillSlug: g.skill?.slug ?? null,
    grantedAt: g.grantedAt,
    revokedAt: g.revokedAt,
    expiresAt: g.expiresAt,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// redesign(10) Phase 1 — unified catalog queries (books + skills).
//
// These are net-new exports that Phases 2–5 will wire into the merged
// storefront UI. Existing books-only helpers (getBooksWithMetrics,
// getBooksForLibrary, getBookAccessStates) STAY in this file — Phase 3
// migrates callers off them before any deletion. Don't break the existing
// surface during Phase 1.
//
// Imports for BookCoverPalette + StorefrontKind live at the top of the file
// (ES modules require imports at module scope) — see the import block at
// lines 1-7.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Landing-page stats (real-DB-backed, replaces hardcoded marketing nums) ──

export type LandingStats = {
  /** ACTIVE books + ACTIVE skills. */
  titlesInPrint: number;
  /** Distinct fetch_logs.api_key_id over the last 30 days, source=agent_fetch. */
  activeAgents30d: number;
  /** SUM(output_tokens) over the last 30 days, source=agent_fetch. */
  tokensServed30d: number;
  /** P95 latency_ms over the last 30 days, source=agent_fetch, status=success.
   *  null when no rows are in the window — UI must handle the null case
   *  (Phase 4 will render "—" or similar). */
  fetchP95Ms: number | null;
};

// Single-round-trip CTE over titles + fetch metrics. Two CTEs are evaluated
// independently; the final SELECT cross-joins them (both produce exactly one
// row). PERCENTILE_CONT can't be expressed through Prisma's typed query
// builder so the whole thing is $queryRaw.
//
// Type-casting notes:
//   - COUNT(...) returns BIGINT in Postgres; cast to INT for JS-safe numbers
//     (all counts here are well within INT range).
//   - SUM(output_tokens) is BIGINT — we cast to BIGINT explicitly and convert
//     to Number on the JS side. A 30-day token total above 2^53 is implausible
//     (would require ~30k tokens/sec sustained for a month).
//   - PERCENTILE_CONT returns DOUBLE PRECISION which Prisma marshals as
//     `number | null` (null when the filter excludes every row).
export async function getLandingStats(): Promise<LandingStats> {
  type Row = {
    titles_in_print: number;
    active_agents_30d: number;
    tokens_served_30d: bigint | number;
    fetch_p95_ms: number | null;
  };
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    WITH
      titles AS (
        SELECT
          (SELECT COUNT(*)::int FROM books  WHERE status = 'ACTIVE')
          + (SELECT COUNT(*)::int FROM skills WHERE status = 'ACTIVE')
            AS titles_in_print
      ),
      fetch_30d AS (
        SELECT
          COUNT(DISTINCT api_key_id) FILTER (WHERE api_key_id IS NOT NULL)::int
            AS active_agents_30d,
          COALESCE(SUM(output_tokens), 0)::bigint
            AS tokens_served_30d,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)
            FILTER (
              WHERE latency_ms IS NOT NULL
                AND status = 'success'
                -- redesign(10)/4 — exclude Bedrock judge calls from the P95
                -- sample. Phase 1's verification surfaced fetch_p95_ms=10150
                -- (~10s) skewed by eval-runner Phase 2 judge turns (Sonnet
                -- 4.5 at ~15s each). The marketing surface wants the
                -- interactive-fetch P95, not the judge-loop P95. We filter
                -- on model string suffixes since fetch_logs.model is a free
                -- text column today (no enum) — anything containing
                -- 'sonnet-4-5' or 'judge' is excluded.
                AND model NOT LIKE '%sonnet-4-5%'
                AND model NOT LIKE '%judge%'
            )
            AS fetch_p95_ms
        FROM fetch_logs
        WHERE created_at > NOW() - INTERVAL '30 days'
          AND source = 'agent_fetch'
      )
    SELECT
      titles.titles_in_print          AS titles_in_print,
      fetch_30d.active_agents_30d     AS active_agents_30d,
      fetch_30d.tokens_served_30d     AS tokens_served_30d,
      fetch_30d.fetch_p95_ms          AS fetch_p95_ms
    FROM titles, fetch_30d
  `);
  const r = rows[0];
  if (!r) {
    // Defensive — the CTE always produces one row, but if for some reason
    // Prisma returns an empty result the UI shouldn't blow up.
    return {
      titlesInPrint: 0,
      activeAgents30d: 0,
      tokensServed30d: 0,
      fetchP95Ms: null,
    };
  }
  return {
    titlesInPrint: r.titles_in_print,
    activeAgents30d: r.active_agents_30d,
    // Prisma marshals BIGINT to JS BigInt by default; coerce to Number for
    // ergonomics. Values well below 2^53 in practice.
    tokensServed30d:
      typeof r.tokens_served_30d === "bigint"
        ? Number(r.tokens_served_30d)
        : r.tokens_served_30d,
    fetchP95Ms:
      r.fetch_p95_ms === null
        ? null
        : Math.round(r.fetch_p95_ms),
  };
}

// ─── Unified library catalog (books + skills) ───────────────────────────────

export type LibraryItem = {
  kind: StorefrontKind;
  id: string;
  slug: string;
  displayName: string;          // book.title OR skill.name
  description: string | null;
  // Book-only; null for skills (no domain/palette/glyph on skills per HANDOFF Q4).
  domain: string | null;
  palette: BookCoverPalette | null;
  glyph: string | null;
  publisherName: string;        // publisherUser.name fallback to publisher.name
  publisherUserName: string | null;
  latestVersion: number;        // 0 if no version exists yet
  createdAt: Date;
};

// Books + skills in one merged list, ACTIVE-only, ordered by createdAt DESC.
// Two parallel findMany calls + JS-side merge — avoids the cross-table union
// SQL gymnastics and keeps the type-safe Prisma client paths. The merge
// preserves chronological order across both tables.
export async function getCatalogForLibrary(): Promise<LibraryItem[]> {
  const [books, skills] = await Promise.all([
    prisma.book.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        domain: true,
        palette: true,
        glyph: true,
        createdAt: true,
        publisher: { select: { name: true } },
        publisherUser: { select: { name: true } },
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: { version: true },
        },
      },
    }),
    prisma.skill.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        createdAt: true,
        publisher: { select: { name: true } },
        publisherUser: { select: { name: true } },
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: { version: true },
        },
      },
    }),
  ]);

  const bookItems: LibraryItem[] = books.map((b) => {
    const userName =
      b.publisherUser?.name && b.publisherUser.name.trim().length > 0
        ? b.publisherUser.name
        : null;
    return {
      kind: "book",
      id: b.id,
      slug: b.slug,
      displayName: b.title,
      description: b.description,
      domain: b.domain,
      palette: b.palette as BookCoverPalette,
      glyph: b.glyph,
      publisherName: userName ?? b.publisher.name,
      publisherUserName: userName,
      latestVersion: b.versions[0]?.version ?? 0,
      createdAt: b.createdAt,
    };
  });

  const skillItems: LibraryItem[] = skills.map((s) => {
    // Skill.publisherUser is NOT NULL in the schema (Stream L D18.1) so this
    // always populates; still defensively coalesce to handle the unlikely
    // Prisma-stale-cache case.
    const userName =
      s.publisherUser?.name && s.publisherUser.name.trim().length > 0
        ? s.publisherUser.name
        : null;
    return {
      kind: "skill",
      id: s.id,
      slug: s.slug,
      displayName: s.name,
      description: s.description,
      domain: null,
      palette: null,
      glyph: null,
      publisherName: userName ?? s.publisher.name,
      publisherUserName: userName,
      latestVersion: s.versions[0]?.version ?? 0,
      createdAt: s.createdAt,
    };
  });

  return [...bookItems, ...skillItems].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

// ─── Unified per-subscriber access map (books + skills) ──────────────────────

export type AccessState = "granted" | "for_sale" | "not_for_sale";

export type CatalogAccessEntry = {
  kind: StorefrontKind;
  id: string;
  state: AccessState;
  unitAmountCents: number | null;
  stripePriceId: string | null;
  grantSource: GrantSource | null;
};

// Returns a Map keyed by `${kind}:${id}` so callers can look up both books
// and skills through one access surface. Internally splits the query along
// the XOR seam (separate book and skill grant queries with explicit
// bookId/skillId NOT NULL filters) — relies on the partial unique indexes
// added in the D18.1 skill migration. Mirrors getBookAccessStates' state
// machine: active grant → "granted"; price + stripePriceId → "for_sale";
// else "not_for_sale". The legacy getBookAccessStates STAYS unchanged for
// now; Phase 3 migrates its callers to this function.
export async function getAccessStatesForCatalog(
  subscriberId: string,
): Promise<Map<string, CatalogAccessEntry>> {
  const [books, skills, bookPrices, skillPrices, bookGrants, skillGrants] =
    await Promise.all([
      prisma.book.findMany({
        where: { status: "ACTIVE" },
        select: { id: true },
      }),
      prisma.skill.findMany({
        where: { status: "ACTIVE" },
        select: { id: true },
      }),
      prisma.bookPrice.findMany({
        where: { currency: "USD" },
        select: { bookId: true, unitAmountCents: true, stripePriceId: true },
      }),
      prisma.skillPrice.findMany({
        where: { currency: "USD" },
        select: { skillId: true, unitAmountCents: true, stripePriceId: true },
      }),
      prisma.accessGrant.findMany({
        where: {
          subscriberId,
          bookId: { not: null },
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { bookId: true, source: true },
      }),
      prisma.accessGrant.findMany({
        where: {
          subscriberId,
          skillId: { not: null },
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { skillId: true, source: true },
      }),
    ]);

  const priceByBook = new Map(
    bookPrices.map((p) => [p.bookId, p]),
  );
  const priceBySkill = new Map(
    skillPrices.map((p) => [p.skillId, p]),
  );
  // After the bookId/skillId-NOT-NULL filters above, the non-null assertion
  // is type-narrowing only — Prisma still types these as nullable because
  // the column is nullable at the schema level (XOR partner is on skillId).
  const grantByBook = new Map(
    bookGrants.map((g) => [g.bookId!, g]),
  );
  const grantBySkill = new Map(
    skillGrants.map((g) => [g.skillId!, g]),
  );

  const out = new Map<string, CatalogAccessEntry>();

  for (const b of books) {
    const grant = grantByBook.get(b.id);
    const price = priceByBook.get(b.id);
    const key = `book:${b.id}`;
    if (grant) {
      out.set(key, {
        kind: "book",
        id: b.id,
        state: "granted",
        unitAmountCents: price?.unitAmountCents ?? null,
        stripePriceId: price?.stripePriceId ?? null,
        grantSource: grant.source,
      });
    } else if (price && price.stripePriceId) {
      out.set(key, {
        kind: "book",
        id: b.id,
        state: "for_sale",
        unitAmountCents: price.unitAmountCents,
        stripePriceId: price.stripePriceId,
        grantSource: null,
      });
    } else {
      out.set(key, {
        kind: "book",
        id: b.id,
        state: "not_for_sale",
        unitAmountCents: price?.unitAmountCents ?? null,
        stripePriceId: price?.stripePriceId ?? null,
        grantSource: null,
      });
    }
  }

  for (const s of skills) {
    const grant = grantBySkill.get(s.id);
    const price = priceBySkill.get(s.id);
    const key = `skill:${s.id}`;
    if (grant) {
      out.set(key, {
        kind: "skill",
        id: s.id,
        state: "granted",
        unitAmountCents: price?.unitAmountCents ?? null,
        stripePriceId: price?.stripePriceId ?? null,
        grantSource: grant.source,
      });
    } else if (price && price.stripePriceId) {
      out.set(key, {
        kind: "skill",
        id: s.id,
        state: "for_sale",
        unitAmountCents: price.unitAmountCents,
        stripePriceId: price.stripePriceId,
        grantSource: null,
      });
    } else {
      out.set(key, {
        kind: "skill",
        id: s.id,
        state: "not_for_sale",
        unitAmountCents: price?.unitAmountCents ?? null,
        stripePriceId: price?.stripePriceId ?? null,
        grantSource: null,
      });
    }
  }

  return out;
}

// ─── Top-N recent ACTIVE books (login left-rail shelf) ──────────────────────
//
// redesign(10)/4 — replaces the hardcoded SHELF_COVERS array in /login
// (3 fabricated Etumos / Northpoint / etc entries). Returns the N most
// recently-created ACTIVE books with the fields the BookCover SVG needs
// (slug + title + palette + glyph). Books only — skills don't carry
// palette/glyph for the cover render. If catalog is smaller than `limit`,
// returns however many exist; caller falls back to its own empty state.

export type RecentBookCover = {
  slug: string;
  title: string;
  palette: BookCoverPalette;
  glyph: string;
};

export async function topRecentBooks(limit: number): Promise<RecentBookCover[]> {
  const rows = await prisma.book.findMany({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { slug: true, title: true, palette: true, glyph: true },
  });
  return rows.map((b) => ({
    slug: b.slug,
    title: b.title,
    palette: b.palette as BookCoverPalette,
    glyph: b.glyph,
  }));
}
