// redesign(10) Phase 1 — unified storefront items endpoint.
//
// Replacement target for /api/storefront/books (which STAYS during Phase 1;
// Phase 3 will delete it once the storefront UI migrates). This route
// returns books AND skills as a single discriminated-union array, plus the
// caller's per-item access map when authenticated.
//
// Response shape (locked):
//   {
//     items: StorefrontItem[],
//     accessByItem?: { [key: "book:<id>" | "skill:<id>"]: CatalogAccessEntry }
//   }
//
// `accessByItem` is OMITTED when the request is unauthenticated (no session,
// no subscriber). When present, the keys match the map keys produced by
// getAccessStatesForCatalog — `${kind}:${id}`.
//
// Auth model — anonymous OK (returns items without accessByItem); session
// cookie elevates to per-subscriber access state. The agent-API Bearer
// token is NOT accepted here — this is a UI-facing list endpoint, not the
// /api/{books,skills}/<slug>/files install path.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  getCatalogForLibrary,
  getAccessStatesForCatalog,
  type CatalogAccessEntry,
  type LibraryItem,
} from "@/lib/dashboard/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The storefront UI consumes a flatter shape than LibraryItem — it needs
// price + state inline per row (the existing /api/storefront/books returns
// this same merged shape today). We extend LibraryItem with the priced +
// stated fields rather than introducing a third type. The price+state
// fields are populated from the access map when available; otherwise
// fall back to the public BookPrice/SkillPrice lookup (anonymous browsers
// still need to see prices).
export type StorefrontItem = LibraryItem & {
  unitAmountCents: number | null;
  stripePriceId: string | null;
  // state is undefined when the request is unauthenticated (caller falls
  // back to "for_sale if stripePriceId else not_for_sale"). When the caller
  // is authenticated, this reflects their per-item access.
  state?: "granted" | "for_sale" | "not_for_sale";
  grantSource?: CatalogAccessEntry["grantSource"];
};

export async function GET() {
  // Always fetch the catalog. Anonymous callers get items without access state.
  const session = await auth();
  let subscriberId: string | null = null;
  if (session?.user?.email) {
    const subscriber = await prisma.subscriber.findFirst({
      where: { user: { email: session.user.email } },
      select: { id: true },
    });
    subscriberId = subscriber?.id ?? null;
  }

  // Parallel fan-out: catalog (always) + access map (if signed in) + public
  // price tables (for the anonymous-path price display). The public price
  // tables are redundant with the access map's price fields when a session
  // exists, but the cost is two small index lookups and the response is
  // simpler when we don't have to branch on session existence per row.
  const [catalog, accessByItem, bookPrices, skillPrices] = await Promise.all([
    getCatalogForLibrary(),
    subscriberId
      ? getAccessStatesForCatalog(subscriberId)
      : Promise.resolve(null),
    prisma.bookPrice.findMany({
      where: { currency: "USD" },
      select: { bookId: true, unitAmountCents: true, stripePriceId: true },
    }),
    prisma.skillPrice.findMany({
      where: { currency: "USD" },
      select: { skillId: true, unitAmountCents: true, stripePriceId: true },
    }),
  ]);

  const priceByBook = new Map(bookPrices.map((p) => [p.bookId, p]));
  const priceBySkill = new Map(skillPrices.map((p) => [p.skillId, p]));

  const items: StorefrontItem[] = catalog.map((item) => {
    const key = `${item.kind}:${item.id}`;
    const access = accessByItem?.get(key);
    const fallbackPrice =
      item.kind === "book"
        ? priceByBook.get(item.id)
        : priceBySkill.get(item.id);
    return {
      ...item,
      unitAmountCents:
        access?.unitAmountCents ?? fallbackPrice?.unitAmountCents ?? null,
      stripePriceId:
        access?.stripePriceId ?? fallbackPrice?.stripePriceId ?? null,
      state: access?.state,
      grantSource: access?.grantSource,
    };
  });

  const body: {
    items: StorefrontItem[];
    accessByItem?: Record<string, CatalogAccessEntry>;
  } = { items };

  if (accessByItem) {
    // Map → plain object for JSON serialization. Caller can rebuild the Map
    // on the client if they want O(1) lookups; for the small catalog sizes
    // here the object-iteration cost is negligible.
    const obj: Record<string, CatalogAccessEntry> = {};
    for (const [k, v] of accessByItem) obj[k] = v;
    body.accessByItem = obj;
  }

  return NextResponse.json(body);
}
