// Move 2 / Phase 1.5 — owned-items query behind GET /api/cli/library.
//
// Returns every book/skill the subscriber holds a LIVE AccessGrant for,
// normalized into the single shape the CLI's `list` command renders.
// "Live" = non-revoked and non-expired — the same grant predicate used by
// resolveInstallAccess (Move 1) and getAccessStatesForCatalog.
//
// ARCHIVED items are excluded (filtered in the query via the relation):
// a subscriber may still own a retired book/skill, but the CLI list
// surfaces only what's current. Books in DRAFT are NOT excluded — the
// dispatch scopes the exclusion to ARCHIVED, and a DRAFT grant is only
// reachable via a publisher owning their own unpublished book.
//
// Dedup: the access_grants partial unique index keys on
// (subscriber_id, book_id, source) — so a subscriber CAN hold two live
// grants for one item via different sources (e.g. a SEED grant plus a
// later PURCHASE). We collapse to one row per item, keeping the EARLIEST
// grantedAt as the honest "owned since" date.

import { prisma } from "@/lib/db";

export type NormalizedItem = {
  kind: "book" | "skill";
  slug: string;
  title: string;
  description: string | null;
  unitAmountCents: number | null;
  isFree: boolean;
  publisher: string;
  grantedAt: string; // ISO-8601
};

// Publisher attribution mirrors getCatalogForLibrary / getBooksForLibrary:
// the per-user publisher name wins when present and non-empty, else the
// tenant Publisher name. (publisher_user_id is staged-NULL on the older
// seed books — see schema D11.10 / #68.)
function publisherName(
  publisherUser: { name: string | null } | null,
  publisher: { name: string },
): string {
  const userName = publisherUser?.name?.trim();
  return userName && userName.length > 0 ? userName : publisher.name;
}

type Row = { key: string; grantedAt: Date; item: NormalizedItem };

export async function listOwnedItems(
  subscriberId: string,
): Promise<NormalizedItem[]> {
  // Live-grant predicate, shared by the book and skill queries.
  const live = {
    subscriberId,
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  };

  // Split along the AccessGrant XOR seam (book_id / skill_id), exactly as
  // getAccessStatesForCatalog does. ARCHIVED items are dropped here via the
  // relation filter so they never reach normalization.
  const [bookGrants, skillGrants] = await Promise.all([
    prisma.accessGrant.findMany({
      where: {
        ...live,
        bookId: { not: null },
        book: { status: { not: "ARCHIVED" } },
      },
      select: {
        grantedAt: true,
        book: {
          select: {
            id: true,
            slug: true,
            title: true,
            description: true,
            publisher: { select: { name: true } },
            publisherUser: { select: { name: true } },
            prices: {
              where: { currency: "USD" },
              select: { unitAmountCents: true },
              take: 1,
            },
          },
        },
      },
    }),
    prisma.accessGrant.findMany({
      where: {
        ...live,
        skillId: { not: null },
        skill: { status: { not: "ARCHIVED" } },
      },
      select: {
        grantedAt: true,
        skill: {
          select: {
            id: true,
            slug: true,
            name: true,
            description: true,
            publisher: { select: { name: true } },
            publisherUser: { select: { name: true } },
            price: { select: { unitAmountCents: true } },
          },
        },
      },
    }),
  ]);

  const rows: Row[] = [];

  for (const g of bookGrants) {
    const b = g.book;
    // bookId NOT NULL ⇒ book present (AccessGrant.book is ON DELETE CASCADE);
    // the guard is type-narrowing only.
    if (!b) continue;
    const cents = b.prices[0]?.unitAmountCents ?? null;
    rows.push({
      key: `book:${b.id}`,
      grantedAt: g.grantedAt,
      item: {
        kind: "book",
        slug: b.slug,
        title: b.title,
        description: b.description,
        unitAmountCents: cents,
        isFree: cents == null || cents === 0,
        publisher: publisherName(b.publisherUser, b.publisher),
        grantedAt: g.grantedAt.toISOString(),
      },
    });
  }

  for (const g of skillGrants) {
    const s = g.skill;
    if (!s) continue;
    const cents = s.price?.unitAmountCents ?? null;
    rows.push({
      key: `skill:${s.id}`,
      grantedAt: g.grantedAt,
      item: {
        kind: "skill",
        slug: s.slug,
        title: s.name, // skills have `name`, not `title`
        description: s.description,
        unitAmountCents: cents,
        isFree: cents == null || cents === 0,
        publisher: publisherName(s.publisherUser, s.publisher),
        grantedAt: g.grantedAt.toISOString(),
      },
    });
  }

  // Collapse multi-source grants → one row per item, keeping the earliest
  // grant (the item's `grantedAt` is already that grant's, since each Row
  // built its item from its own grant).
  const byKey = new Map<string, Row>();
  for (const r of rows) {
    const existing = byKey.get(r.key);
    if (!existing || r.grantedAt < existing.grantedAt) byKey.set(r.key, r);
  }

  // Sort by grantedAt DESC — most-recently-acquired first.
  return [...byKey.values()]
    .sort((a, b) => b.grantedAt.getTime() - a.grantedAt.getTime())
    .map((r) => r.item);
}
