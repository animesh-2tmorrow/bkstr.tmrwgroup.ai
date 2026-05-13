/**
 * GET /api/books/check-slug?slug=<slug>&kind=book|skill — Phase 6 Stream K (D17.1) +
 * Stream L (D18.1) generalization.
 *
 * Slug-existence prefetch for the new-book/new-skill form. Driven by the form's
 * debounced lookup when a publisher types a slug; the response shape lets the
 * form (a) lock the price field with the existing item's price and (b) show a
 * "creates v{N+1} of '<title|name>' — price stays at $X" banner instead of
 * silently overriding form input on submit.
 *
 * L generalization: `?kind=book` (default) queries the `books` table; `?kind=skill`
 * queries the `skills` table. The route filename stays `/api/books/check-slug` to
 * preserve backward compat (existing callers don't pass `kind`). Mild URL-
 * semantics smell, same scope as the form's `/dashboard/books/new` URL — accepted,
 * not refactored.
 *
 * Publisher-scoped per T1: resolves only against `tmrwgroup` (single-tenant
 * today; the unique key on both tables is `@@unique([publisherId, slug])`, so
 * the same slug could in principle exist under a different publisher — the
 * schema allows it, this endpoint mirrors that).
 *
 * Auth: identical gate to /api/books/new — session required, role ∈
 * {PUBLISHER, ADMIN}. We don't leak slug existence to unauthenticated callers
 * (slugs aren't deeply sensitive, but publisher-only space is publisher-only).
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

type CheckKind = "book" | "skill";

function parseKind(raw: string | null): CheckKind | { error: string } {
  if (raw === null || raw === "" || raw === "book") return "book";
  if (raw === "skill") return "skill";
  return { error: `Invalid 'kind' query param '${raw}' (allowed: 'book' | 'skill')` };
}

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

  const kindParsed = parseKind(request.nextUrl.searchParams.get("kind"));
  if (typeof kindParsed !== "string") {
    return NextResponse.json({ error: kindParsed.error }, { status: 400 });
  }
  const kind: CheckKind = kindParsed;

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

  if (kind === "skill") {
    const skill = await prisma.skill.findUnique({
      where: { publisherId_slug: { publisherId: publisher.id, slug } },
      select: {
        id: true,
        name: true,
        status: true,
        price: { select: { unitAmountCents: true } },
        versions: {
          orderBy: { version: "desc" },
          select: { version: true },
          take: 1,
        },
      },
    });
    if (!skill) {
      return NextResponse.json({ exists: false, kind: "skill" });
    }
    return NextResponse.json({
      exists: true,
      kind: "skill",
      skillId: skill.id,
      name: skill.name,
      currentPriceUsdCents: skill.price?.unitAmountCents ?? null,
      latestVersion: skill.versions[0]?.version ?? null,
      status: skill.status,
    });
  }

  // kind === "book" — original Stream K behavior, unchanged response shape
  // (no `kind` field on legacy callers' response to preserve backward compat).
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
