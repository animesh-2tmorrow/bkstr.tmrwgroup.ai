import { Prisma, Role, type GrantSource } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

export type BookWithMetrics = {
  id: string;
  title: string;
  slug: string;
  domain: string;
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
    latest_version: number;
    total_fetches: number;
    fetches_30d: number;
    active_agents_30d: number;
    last_fetched_at: Date | null;
  };
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT
      b.id::text                                                                          AS id,
      b.title                                                                             AS title,
      b.slug                                                                              AS slug,
      b.domain                                                                            AS domain,
      COALESCE(MAX(bv.version), 0)::int                                                   AS latest_version,
      COUNT(fl.id)::int                                                                   AS total_fetches,
      COUNT(fl.id) FILTER (WHERE fl.created_at > NOW() - INTERVAL '30 days')::int         AS fetches_30d,
      COUNT(DISTINCT fl.api_key_id)
        FILTER (WHERE fl.created_at > NOW() - INTERVAL '30 days')::int                    AS active_agents_30d,
      MAX(fl.created_at)                                                                  AS last_fetched_at
    FROM books b
    LEFT JOIN book_versions bv ON bv.book_id = b.id
    LEFT JOIN fetch_logs fl    ON fl.book_version_id = bv.id
    GROUP BY b.id, b.title, b.slug, b.domain
    ORDER BY b.title
  `);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    domain: r.domain,
    latestVersion: r.latest_version,
    totalFetches: r.total_fetches,
    fetches30d: r.fetches_30d,
    activeAgents30d: r.active_agents_30d,
    lastFetchedAt: r.last_fetched_at,
  }));
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
export type PricingBookRow = {
  id: string;
  title: string;
  slug: string;
  domain: string;
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

export async function getBooksForLibrary(): Promise<LibraryBook[]> {
  const rows = await prisma.book.findMany({
    where: { status: "ACTIVE" },
    orderBy: { title: "asc" },
    select: {
      id: true,
      title: true,
      slug: true,
      domain: true,
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
export type AdminGrantRow = {
  id: string;
  source: GrantSource;
  subscriberId: string;
  subscriberEmail: string;
  bookId: string;
  bookTitle: string;
  bookSlug: string;
  grantedAt: Date;
  revokedAt: Date | null;
  expiresAt: Date | null;
};

export async function getAdminGrants(opts: {
  source?: GrantSource;
  subscriberId?: string;
  bookId?: string;
}): Promise<AdminGrantRow[]> {
  // Build the where clause from optional filters — undefined keys are
  // dropped by Prisma so the no-filter call returns every grant row.
  const where: Prisma.AccessGrantWhereInput = {};
  if (opts.source) where.source = opts.source;
  if (opts.subscriberId) where.subscriberId = opts.subscriberId;
  if (opts.bookId) where.bookId = opts.bookId;

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
          user: { select: { email: true } },
        },
      },
      book: { select: { title: true, slug: true } },
    },
  });

  return grants.map((g) => ({
    id: g.id,
    source: g.source,
    subscriberId: g.subscriberId,
    subscriberEmail: g.subscriber.email || g.subscriber.user?.email || "—",
    bookId: g.bookId,
    bookTitle: g.book.title,
    bookSlug: g.book.slug,
    grantedAt: g.grantedAt,
    revokedAt: g.revokedAt,
    expiresAt: g.expiresAt,
  }));
}
