// Phase 6 Stream K (D17.1) — internal zip-upload handler for /api/books/new.
//
// Called from route.ts when Content-Type is multipart/form-data. The caller
// has already done the shared auth + role check; this function owns the rest.
//
// Architecture notes (cross-ref D17.1):
//   - Stripe products.create + prices.create happen PRE-TRANSACTION (D11.7
//     Stripe-first ordering). On the new-book branch only; on the new-
//     version-of-existing-book branch the existing Stripe Product/Price is
//     reused (T2 — no re-pricing on re-upload).
//   - The authoritative existing-book lookup happens INSIDE the transaction
//     (T1 TOCTOU): a publisher could in principle race two concurrent uploads
//     for the same slug. Postgres's @@unique([publisherId, slug]) enforces the
//     invariant at write time; we keep the WRITE in a transaction whose SELECT
//     of the conflict-row runs at the same isolation snapshot. The pre-tx
//     "peek" exists only to decide whether to call Stripe — if the peek says
//     "new" but the inside-tx authoritative SELECT says "existing," we abort
//     with a RACE_DETECTED error and surface the orphan Stripe IDs for the
//     existing partial-failure recovery path (mirrors Stream B's D11.7 CC-9
//     orphan shape).
//   - Audit (writeAuditEntry) runs INSIDE the interactive transaction
//     callback (D12.4). action_type='book.zip_upload' (D12.5 dot-delimited).
//     before_state/after_state capture changing fields only (D12.14).
//
// Returns a NextResponse — JSON in all branches, status varies per outcome.

import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { BookStatus, GrantSource, Prisma } from "@/generated/prisma/client";
import { writeAuditEntry } from "@/lib/admin/audit";
import { createHash } from "node:crypto";
import { processZipUpload } from "@/lib/books/zip-upload";
import { MAX_ZIP_BYTES } from "@/lib/books/zip-validate";
import { getVersionContent } from "@/lib/books/content";
import type { ZipUploadFields } from "@/lib/books/zip-upload.types";

const TMRWGROUP_PUBLISHER_SLUG = "tmrwgroup";
const STRIPE_MIN_CENTS = 50;

function jsonError(status: number, error: string, code?: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...(code ? { code } : {}), ...extra }, { status });
}

function readFormString(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readFormInt(fd: FormData, key: string): number | undefined {
  const raw = fd.get(key);
  if (typeof raw !== "string") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return undefined;
  return n;
}

export async function handleZipUpload(request: Request, session: Session): Promise<NextResponse> {
  // ─── Multipart parse ────────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError(400, "Invalid multipart/form-data body");
  }

  const zipBlob = formData.get("zip");
  if (!(zipBlob instanceof File)) {
    return jsonError(400, "Missing 'zip' file field", "MISSING_ZIP_FIELD");
  }
  if (zipBlob.size > MAX_ZIP_BYTES) {
    return jsonError(
      413,
      `Zip too large (${zipBlob.size} bytes) — limit is ${MAX_ZIP_BYTES} bytes`,
      "ZIP_TOO_LARGE",
    );
  }

  const formFields: ZipUploadFields = {
    title: readFormString(formData, "title"),
    slug: readFormString(formData, "slug"),
    domain: readFormString(formData, "domain"),
    description: readFormString(formData, "description"),
    priceUsdCents: readFormInt(formData, "price_usd_cents"),
  };

  // userId comes from session
  if (!session.user?.id) {
    return jsonError(401, "Unauthorized");
  }
  const actorUserId = session.user.id;

  const buffer = Buffer.from(await zipBlob.arrayBuffer());

  // ─── Resolve publisher (single-tenant per Phase 4 §0.1) ─────────────────
  const publisher = await prisma.publisher.findFirst({
    where: { slug: TMRWGROUP_PUBLISHER_SLUG },
    select: { id: true },
  });
  if (!publisher) {
    return jsonError(
      500,
      `Publisher '${TMRWGROUP_PUBLISHER_SLUG}' not found. Operator: seed it via 'npm run import-book' or SQL INSERT.`,
    );
  }

  // ─── Resolve subscriber row (needed for PUBLISHER_OWN grant) ────────────
  const subscriber = await prisma.subscriber.findFirst({
    where: { userId: actorUserId },
    select: { id: true },
  });
  if (!subscriber) {
    return jsonError(500, "Subscriber row missing for current user — operator must seed via SQL.");
  }

  // ─── Zip processing (pure-ish: parse, validate, manifest, chapters, hash) ─
  const processed = await processZipUpload(buffer, formFields);
  if (processed.kind === "rejected") {
    return jsonError(processed.status, processed.error, processed.code);
  }

  // ─── Pre-tx peek for existing book (informs Stripe decision only) ───────
  const peeked = await prisma.book.findUnique({
    where: { publisherId_slug: { publisherId: publisher.id, slug: processed.slug } },
    select: {
      id: true,
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: {
          id: true,
          bookId: true,
          version: true,
          content: true,
          contentUri: true,
          chapters: { orderBy: { order: "asc" }, select: { order: true, content: true } },
        },
      },
    },
  });

  // ─── Idempotency: if the latest existing version's content equals the
  //     draft, short-circuit with 200 {unchanged:true}. Mirrors import-book.ts.
  if (peeked?.versions[0]) {
    const latestContent = await getVersionContent(peeked.versions[0]);
    const latestHash = createHash("sha256").update(latestContent, "utf8").digest("hex");
    if (latestHash === processed.draftHash) {
      return NextResponse.json(
        {
          id: peeked.id,
          slug: processed.slug,
          version: peeked.versions[0].version,
          unchanged: true,
        },
        { status: 200 },
      );
    }
  }

  // ─── Stripe create (NEW-BOOK BRANCH ONLY; pre-tx per D11.7) ─────────────
  let stripeProductId: string | undefined;
  let stripePriceId: string | undefined;
  if (!peeked) {
    // Price is form-only on the new-book branch (D-K3).
    if (formFields.priceUsdCents == null || formFields.priceUsdCents < STRIPE_MIN_CENTS) {
      return jsonError(
        400,
        `price_usd_cents must be an integer >= ${STRIPE_MIN_CENTS} (Stripe USD minimum) for new books`,
        "MISSING_REQUIRED_FIELD",
      );
    }
    try {
      const product = await stripe.products.create({
        name: processed.title,
        description: processed.description ?? undefined,
        metadata: { book_id: processed.bookIdIfNew, book_slug: processed.slug },
      });
      stripeProductId = product.id;
      const price = await stripe.prices.create({
        product: stripeProductId,
        unit_amount: formFields.priceUsdCents,
        currency: "usd",
        metadata: { book_id: processed.bookIdIfNew, book_slug: processed.slug },
      });
      stripePriceId = price.id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown Stripe error";
      console.error(`[books/new zip] Stripe step failed: ${msg}`);
      return jsonError(502, `Stripe error: ${msg}`);
    }
  }
  // For the existing-book branch the form's price field is ignored (T2).

  // ─── Interactive transaction (D12.4) — authoritative resolution inside ──
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Authoritative re-resolve. If the peek said "new" but reality (under
      // READ COMMITTED) says "existing," a concurrent upload won the race
      // between our peek and our tx — abort with orphan Stripe IDs.
      const existing = await tx.book.findUnique({
        where: { publisherId_slug: { publisherId: publisher.id, slug: processed.slug } },
        select: {
          id: true,
          versions: { orderBy: { version: "desc" }, take: 1, select: { version: true } },
        },
      });

      if (existing && !peeked) {
        // Race: peek saw no book, tx sees one. Stripe Product+Price already
        // created and now orphaned — surface them for operator reconciliation.
        throw Object.assign(new Error("RACE_DETECTED_NEW_TO_EXISTING"), {
          __race: true as const,
        });
      }
      if (!existing && peeked) {
        // Race in the other direction (publisher deleted their own book
        // mid-flight, or our connection saw stale data). Less likely but
        // handle: fail loudly, no Stripe to orphan because we didn't create it.
        throw Object.assign(new Error("RACE_DETECTED_EXISTING_TO_NEW"), {
          __race: true as const,
        });
      }

      let bookId: string;
      let nextVersion: number;
      let beforeVersion: number | null;

      if (existing) {
        bookId = existing.id;
        beforeVersion = existing.versions[0]?.version ?? null;
        nextVersion = (beforeVersion ?? 0) + 1;
        // No Stripe writes, no BookPrice writes — reuse existing.
      } else {
        bookId = processed.bookIdIfNew;
        beforeVersion = null;
        nextVersion = 1;
        await tx.book.create({
          data: {
            id: bookId,
            publisherId: publisher.id,
            publisherUserId: actorUserId,
            slug: processed.slug,
            title: processed.title,
            description: processed.description,
            domain: processed.domain,
            status: BookStatus.ACTIVE,
          },
        });
        await tx.bookPrice.create({
          data: {
            bookId,
            currency: "USD",
            unitAmountCents: formFields.priceUsdCents!,
            stripePriceId,
          },
        });
        await tx.accessGrant.createMany({
          data: [{ subscriberId: subscriber.id, bookId, source: GrantSource.PUBLISHER_OWN }],
          skipDuplicates: true,
        });
      }

      const versionId = processed.bookVersionId;
      await tx.bookVersion.create({
        data: {
          id: versionId,
          bookId,
          version: nextVersion,
          contentUri: `inline://${versionId}`, // stable placeholder; chapters carry the content
          byteSize: processed.totalBytes,
          content: null, // chapterized — content lives in book_chapters
          manifest: processed.manifestJson as Prisma.InputJsonValue,
        },
      });
      await tx.bookChapter.createMany({
        data: processed.chapters.map((c) => ({
          bookVersionId: versionId,
          order: c.order,
          slug: c.slug,
          title: c.title,
          content: c.content,
          tokenEstimate: c.tokenEstimate,
          metadata: c.metadata as Prisma.InputJsonValue,
        })),
      });

      await writeAuditEntry(tx, {
        actorUserId,
        actionType: "book.zip_upload",
        targetType: "book",
        targetId: bookId,
        beforeState: { existing_version: beforeVersion },
        afterState: {
          new_version: nextVersion,
          chapter_count: processed.chapters.length,
          manifest_present: processed.manifestPresent,
          total_bytes: processed.totalBytes,
          // Phase 6 Stream K.1 (D17.2) — wrapping prefix used during path
          // resolution (null for flat zips) + how chapter slugs were chosen.
          virtual_root: processed.virtualRoot,
          slug_derivation: processed.slugDerivation,
        },
      });

      return {
        id: bookId,
        slug: processed.slug,
        version: nextVersion,
        chapterCount: processed.chapters.length,
        created: !existing,
      };
    });

    // Best-effort Stripe Product metadata refresh (mirrors Stream B CC-9 step 10).
    if (result.created && stripeProductId) {
      try {
        await stripe.products.update(stripeProductId, {
          metadata: { book_id: result.id, book_slug: result.slug },
        });
      } catch (err) {
        console.warn(
          `[books/new zip] Stripe metadata refresh failed (non-fatal): product=${stripeProductId} ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const isRace =
      typeof err === "object" && err !== null && "__race" in err && (err as { __race: boolean }).__race;
    const msg = err instanceof Error ? err.message : "Unknown error";

    if (isRace && stripeProductId && stripePriceId) {
      console.error(
        `[books/new zip] Race detected: peek saw no book but tx found one. ORPHAN Stripe IDs: product=${stripeProductId} price=${stripePriceId}. metadata.book_slug=${processed.slug}.`,
      );
      return NextResponse.json(
        {
          error: `Slug '${processed.slug}' was claimed by a concurrent upload between the slug-check and the write. Retry the upload — the next attempt will see the existing book and add a new version.`,
          code: "RACE_DETECTED",
          orphanStripeProductId: stripeProductId,
          orphanStripePriceId: stripePriceId,
          recovery:
            "The Stripe Product+Price were pre-allocated for what looked like a new book but the slug now exists. Retry the upload (it will fall through to the new-version path and skip Stripe). If the operator needs to clean up the orphan Product, see docs/operations.md 'Stream B partial-failure recovery'.",
        },
        { status: 409 },
      );
    }
    if (isRace) {
      // No Stripe to orphan (existing-to-new race direction).
      return jsonError(409, msg, "RACE_DETECTED");
    }

    if (!peeked && stripeProductId && stripePriceId) {
      console.error(
        `[books/new zip] Local TX failed AFTER Stripe Product+Price created. ORPHAN: product=${stripeProductId} price=${stripePriceId}. Error: ${msg}`,
      );
      return NextResponse.json(
        {
          error: `Local transaction failed: ${msg}`,
          orphanStripeProductId: stripeProductId,
          orphanStripePriceId: stripePriceId,
          recovery:
            "See docs/operations.md 'Stream B — new book published with Stripe Product/Price success but local TX failure'. The same recovery path applies to the zip-upload new-book branch.",
        },
        { status: 500 },
      );
    }
    return jsonError(500, `Local transaction failed: ${msg}`);
  }
}
