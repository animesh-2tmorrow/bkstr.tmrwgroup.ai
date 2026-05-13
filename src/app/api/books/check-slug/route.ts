/**
 * GET /api/books/check-slug?slug=<slug> — Phase 6 Stream K (D17.1).
 *
 * Slug-existence prefetch for the new-book form's zip-upload mode (T2 option (a)).
 * On the upload form, when a publisher types a slug in zip mode the client
 * debounce-hits this endpoint to learn whether the slug is already taken under
 * the caller's publisher. The answer drives a UI banner ("creates v{N+1} of
 * '<title>' — price stays at $X") and locks the price field on the existing-
 * book branch (D-K3 / T2 — price changes go through the pricing surface, not
 * upload). Without this prefetch, the form would have to either silently
 * accept-and-ignore the typed price or surprise the user at submit time.
 *
 * Publisher-scoped per T1: resolves only against `tmrwgroup` (single-tenant
 * today; the unique key is `@@unique([publisherId, slug])`, so the same slug
 * could in principle exist under a different publisher — the schema allows
 * it, this endpoint mirrors that).
 *
 * Auth: identical gate to /api/books/new — session required, role ∈
 * {PUBLISHER, ADMIN}. We don't leak slug existence to unauthenticated callers
 * (slugs aren't deeply sensitive, but publisher-only space is publisher-only
 * space).
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Role } from "@/generated/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLUG_REGEX = /^[a-z0-9-]+$/;
const SLUG_MAX = 128;
const TMRWGROUP_PUBLISHER_SLUG = "tmrwgroup";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email || !session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== Role.PUBLISHER && session.user.role !== Role.ADMIN) {
    return NextResponse.json({ error: "PUBLISHER or ADMIN role required" }, { status: 403 });
  }

  const slug = request.nextUrl.searchParams.get("slug")?.trim().toLowerCase() ?? "";
  if (slug.length === 0 || slug.length > SLUG_MAX || !SLUG_REGEX.test(slug)) {
    return NextResponse.json(
      { error: "Slug must be 1..128 chars of lowercase letters, digits, and hyphens" },
      { status: 400 },
    );
  }

  // Resolve tmrwgroup publisher (single-tenant per Phase 4 §0.1). If absent,
  // 500 with the same operator message the new-book route uses — same recovery
  // path (seed via import-book.ts or SQL).
  const publisher = await prisma.publisher.findFirst({
    where: { slug: TMRWGROUP_PUBLISHER_SLUG },
    select: { id: true },
  });
  if (!publisher) {
    return NextResponse.json(
      { error: `Publisher '${TMRWGROUP_PUBLISHER_SLUG}' not found.` },
      { status: 500 },
    );
  }

  // One round trip: find the book if any, with its USD price and latest version.
  const book = await prisma.book.findUnique({
    where: { publisherId_slug: { publisherId: publisher.id, slug } },
    select: {
      id: true,
      title: true,
      status: true,
      prices: {
        where: { currency: "USD" },
        select: { unitAmountCents: true },
        take: 1,
      },
      versions: {
        orderBy: { version: "desc" },
        select: { version: true },
        take: 1,
      },
    },
  });

  if (!book) {
    return NextResponse.json({ exists: false });
  }

  return NextResponse.json({
    exists: true,
    bookId: book.id,
    title: book.title,
    currentPriceUsdCents: book.prices[0]?.unitAmountCents ?? null,
    latestVersion: book.versions[0]?.version ?? null,
    status: book.status,
  });
}
