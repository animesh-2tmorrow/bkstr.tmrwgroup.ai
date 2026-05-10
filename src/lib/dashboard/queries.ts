import { Prisma } from "@/generated/prisma/client";
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
