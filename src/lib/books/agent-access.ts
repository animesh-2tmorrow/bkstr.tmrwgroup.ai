// Stream U — agent-consumption access helper for books.
//
// Mirror of src/lib/skills/auth.ts (follow-up #122) for the books side.
// Backs GET /api/books/[id]/files (slug-only despite the [id] dir name;
// see route file's header comment for the Next.js routing-tree rationale).
//
// Compositional shape:
//   - Auth (session OR API-key) — same dual-path as the skills helper.
//   - Slug resolution → Book (status='ACTIVE' gate).
//   - Latest version + chapters in a single Prisma round-trip.
//   - Grant check via the existing src/lib/books/access.ts `requireBookAccess`
//     primitive (D11.4 / Phase 4 Stream C). We DO NOT re-implement the grant
//     predicate; this helper layers the auth + slug-resolve + multi-chapter
//     file assembly on top of the existing leaf-level authz check.
//   - Throws typed BookFetchAccessError with one of four codes; callers
//     translate to HTTP status via the {error, code} envelope helper below.

import { auth } from "@/lib/auth";
import { ApiKeyAuthError, requireApiKey } from "@/lib/auth/api-key";
import { prisma } from "@/lib/db";
import { BookAccessError, requireBookAccess } from "@/lib/books/access";

const SLUG_REGEX = /^[a-z0-9-]+$/;
const SLUG_MAX_LEN = 128;
// Stream U §4 — explicit UUID rejection to enforce slug-only. Stream O's
// fetch_book.py passes slugs; a UUID-shaped input means the caller has the
// wrong contract.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BookFetchAccessErrorCode =
  | "BOOK_NOT_FOUND"
  | "NO_ACTIVE_VERSION"
  | "UNAUTHENTICATED"
  | "ACCESS_DENIED";

export class BookFetchAccessError extends Error {
  status: number;
  code: BookFetchAccessErrorCode;
  constructor(status: number, code: BookFetchAccessErrorCode, message: string) {
    super(message);
    this.name = "BookFetchAccessError";
    this.status = status;
    this.code = code;
  }
}

export type BookFetchAccessFile = {
  path: string;
  content: string;
};

export type BookFetchAccessBundle = {
  authMethod: "session" | "api_key";
  subscriber: { id: string };
  book: {
    id: string;
    slug: string;
    title: string;
  };
  version: {
    id: string;
    version: number;
  };
  files: BookFetchAccessFile[];
};

/**
 * Resolve a book by slug, authorize the requester via session OR API-key,
 * and return everything callers need to build a response. Throws
 * BookFetchAccessError on any of the four documented failure modes.
 *
 * Composition with requireBookAccess (src/lib/books/access.ts): this helper
 * delegates the grant check to that primitive — catches its thrown
 * BookAccessError(403) and re-throws as a BookFetchAccessError with code
 * ACCESS_DENIED so the route surfaces a uniform envelope. Existing
 * UUID-based routes (view/download/cover) continue to use the leaf primitive
 * directly, unchanged.
 */
export async function requireBookFetchAccess(
  request: Request,
  slug: string,
): Promise<BookFetchAccessBundle> {
  // ─── 1. Slug shape gate ────────────────────────────────────────────────
  // Reject UUID-shaped inputs explicitly (Stream U §4) — a caller passing a
  // UUID has the wrong contract for this endpoint. Then enforce the same
  // [a-z0-9-]+ shape the skills helper uses for parity.
  if (typeof slug !== "string" || slug.length === 0 || slug.length > SLUG_MAX_LEN) {
    throw new BookFetchAccessError(404, "BOOK_NOT_FOUND", "Book not found");
  }
  if (UUID_REGEX.test(slug)) {
    throw new BookFetchAccessError(404, "BOOK_NOT_FOUND", "Book not found");
  }
  if (!SLUG_REGEX.test(slug)) {
    throw new BookFetchAccessError(404, "BOOK_NOT_FOUND", "Book not found");
  }

  // ─── 2. Auth — API-key first if Authorization header present, else session ─
  let subscriberId: string;
  let authMethod: "session" | "api_key";
  const authHeader = request.headers.get("authorization") ?? request.headers.get("Authorization");

  if (authHeader) {
    try {
      const apiAuth = await requireApiKey(request);
      subscriberId = apiAuth.subscriber.id;
      authMethod = "api_key";
    } catch (err) {
      if (err instanceof ApiKeyAuthError) {
        throw new BookFetchAccessError(err.status, "UNAUTHENTICATED", err.message);
      }
      throw err;
    }
  } else {
    const session = await auth();
    if (!session?.user?.email) {
      throw new BookFetchAccessError(401, "UNAUTHENTICATED", "Unauthorized");
    }
    const sub = await prisma.subscriber.findFirst({
      where: { user: { email: session.user.email } },
      select: { id: true },
    });
    if (!sub) {
      throw new BookFetchAccessError(403, "ACCESS_DENIED", "No subscriber for current user");
    }
    subscriberId = sub.id;
    authMethod = "session";
  }

  // ─── 3. Resolve book + latest version + chapters (single round trip) ───
  // Mirror skills-side: don't pre-filter by status here so we can distinguish
  // BOOK_NOT_FOUND from NO_ACTIVE_VERSION downstream. Manifest stays raw
  // (typed `unknown` from Prisma's JSON column); we narrow it below.
  const book = await prisma.book.findFirst({
    where: { slug },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: {
          id: true,
          version: true,
          content: true,
          manifest: true,
          chapters: {
            orderBy: { order: "asc" },
            select: { id: true, order: true, slug: true, content: true },
          },
        },
      },
    },
  });

  // Per Stream U dispatch §3 catches — non-ACTIVE books surface as
  // BOOK_NOT_FOUND (not ACCESS_DENIED). Don't disclose existence of
  // ARCHIVED/DRAFT rows at the slug.
  if (!book || book.status !== "ACTIVE") {
    throw new BookFetchAccessError(404, "BOOK_NOT_FOUND", "Book not found");
  }
  const version = book.versions[0];
  if (!version) {
    throw new BookFetchAccessError(404, "NO_ACTIVE_VERSION", "Book has no active version");
  }

  // ─── 4. Files assembly ────────────────────────────────────────────────
  // Multi-chapter (Stream J/K) path:
  //   - manifest.chapters[] is a non-empty array AND DB has chapter rows.
  //   - Return one file per chapter, ordered by BookChapter.order ASC.
  //   - `path` = manifest.chapters[idx].file ?? `chapters/${chapter.slug}.md`.
  // Legacy single-blob path (Phase 2–4 inline; pre-Stream-K):
  //   - manifest has no chapters[] OR DB has no chapter rows AND
  //     BookVersion.content is non-empty.
  //   - Return a single file: path "content.md", content = BookVersion.content.
  // Empty/null/null edge case → NO_ACTIVE_VERSION (never empty files[]).
  const manifestObj = (version.manifest ?? null) as Record<string, unknown> | null;
  const manifestChapters = Array.isArray(manifestObj?.chapters)
    ? (manifestObj!.chapters as Array<Record<string, unknown>>)
    : null;

  let files: BookFetchAccessFile[];
  if (manifestChapters && manifestChapters.length > 0 && version.chapters.length > 0) {
    files = version.chapters.map((c, idx) => {
      const decl = manifestChapters[idx];
      const declaredPath = typeof decl?.file === "string" ? decl.file : null;
      return {
        path: declaredPath ?? `chapters/${c.slug}.md`,
        content: c.content,
      };
    });
  } else if (typeof version.content === "string" && version.content.length > 0) {
    files = [{ path: "content.md", content: version.content }];
  } else {
    throw new BookFetchAccessError(404, "NO_ACTIVE_VERSION", "Book has no readable content");
  }

  // ─── 5. AccessGrant — delegate to the leaf primitive ────────────────────
  // PUBLISHER_OWN, PURCHASE, SEED, MANUAL all count — requireBookAccess
  // doesn't switch on source, just on revoked_at + expires_at. The publisher
  // of this book has a PUBLISHER_OWN grant created at book.create time
  // (D11.3), so they pass this check without a buyer purchase.
  try {
    await requireBookAccess(subscriberId, book.id);
  } catch (err) {
    if (err instanceof BookAccessError) {
      throw new BookFetchAccessError(403, "ACCESS_DENIED", "Access required for this book");
    }
    throw err;
  }

  return {
    authMethod,
    subscriber: { id: subscriberId },
    book: { id: book.id, slug: book.slug, title: book.title },
    version: { id: version.id, version: version.version },
    files,
  };
}

/**
 * Route convenience — converts a BookFetchAccessError to the standard
 * `{ error, code }` envelope. Other thrown errors propagate (caller decides
 * 500 surfacing). Mirrors skillAccessErrorResponse from the skills helper.
 */
export function bookFetchAccessErrorResponse(err: unknown): Response | null {
  if (err instanceof BookFetchAccessError) {
    return new Response(JSON.stringify({ error: err.message, code: err.code }), {
      status: err.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}
