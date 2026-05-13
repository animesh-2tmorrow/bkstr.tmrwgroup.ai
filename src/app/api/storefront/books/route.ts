import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await auth();
    let subscriberId: string | null = null;

    // If user is authenticated, get their subscriber ID to check access state
    if (session?.user?.email) {
      const subscriber = await prisma.subscriber.findFirst({
        where: { user: { email: session.user.email } },
        select: { id: true },
      });
      subscriberId = subscriber?.id ?? null;
    }

    // Fetch all active books with their latest version and pricing
    const books = await prisma.book.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        title: true,
        description: true,
        domain: true,
        coverImageUrl: true,
        prices: {
          where: { currency: "USD" },
          select: {
            unitAmountCents: true,
            stripePriceId: true,
          },
        },
      },
      orderBy: { title: "asc" },
    });

    // Get BOOK access grants for the current user if authenticated.
    // Phase 6 Stream L: AccessGrant.bookId is now nullable (skill grants have
    // bookId=null + skillId set, XOR-checked at the DB layer). The storefront
    // /api/storefront/books endpoint is books-only by design, so we filter
    // book_id IS NOT NULL at query time — keeps the Map<string, …> typing
    // intact and ensures skill grants don't leak into the books view.
    let grantsByBook = new Map<string, { source: string }>();
    if (subscriberId) {
      const grants = await prisma.accessGrant.findMany({
        where: {
          subscriberId,
          bookId: { not: null },
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { bookId: true, source: true },
      });
      // After the `bookId: { not: null }` filter, g.bookId is logically
      // non-null but TS still types it as `string | null` from the Prisma
      // generated client. The non-null assertion narrows it for the Map key.
      grantsByBook = new Map(grants.map((g) => [g.bookId!, { source: g.source }]));
    }

    // Format response
    const booksWithPricing = books.map((book) => {
      const price = book.prices[0];
      const grant = grantsByBook.get(book.id);

      let state: "for_sale" | "not_for_sale" | "granted" = "not_for_sale";
      if (grant) {
        state = "granted";
      } else if (price && price.stripePriceId) {
        state = "for_sale";
      }

      return {
        id: book.id,
        title: book.title,
        description: book.description,
        domain: book.domain,
        coverImageUrl: book.coverImageUrl ?? null,
        unitAmountCents: price?.unitAmountCents ?? null,
        stripePriceId: price?.stripePriceId ?? null,
        state,
        grantSource: grant?.source ?? null,
      };
    });

    return NextResponse.json(booksWithPricing);
  } catch (error) {
    console.error("[storefront/books] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
