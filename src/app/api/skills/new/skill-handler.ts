// Phase 6 Stream L (D18.1) — internal zip-upload handler for /api/skills/new.
//
// Called from route.ts after the shared auth + role check + Content-Type
// dispatch. Mirrors src/app/api/books/new/zip-handler.ts in shape; differences:
//   - operates on Skill/SkillVersion/SkillFile/SkillPrice tables
//   - PUBLISHER_OWN grant carries `skillId` (XOR-checked against bookId in the
//     access_grants table; see D18.1 §1c)
//   - idempotency hash is stored directly on SkillVersion.normalizedHash (no
//     re-load + re-concat needed for the comparison — simpler than books)
//   - audit row: action_type='skill.zip_upload', target_type='skill',
//     after_state includes virtual_root + slug_source (binary: 'frontmatter' |
//     'form'), no slug_derivation 5-way enum
//   - Stripe Product metadata: skill_id, skill_slug
//
// Stripe-first ordering (D11.7) and TOCTOU discipline (T1 from Stream K) carry
// forward identically: pre-tx peek decides Stripe; inside-tx authoritative
// re-resolve surfaces a 409 RACE_DETECTED + orphan-Stripe-IDs if the peek
// disagrees with the tx's view of the world.

import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { GrantSource, Prisma } from "@/generated/prisma/client";
import { writeAuditEntry } from "@/lib/admin/audit";
import { processZipUpload } from "@/lib/skills/zip-upload";
import { MAX_ZIP_BYTES } from "@/lib/zip/limits";
import type { SkillZipFields } from "@/lib/skills/zip-upload.types";

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

export async function handleSkillUpload(
  request: Request,
  session: Session,
): Promise<NextResponse> {
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
      "SKILL_TOO_LARGE",
    );
  }

  const formFields: SkillZipFields = {
    slug: readFormString(formData, "slug"),
    priceUsdCents: readFormInt(formData, "price_usd_cents"),
  };

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
      `Publisher '${TMRWGROUP_PUBLISHER_SLUG}' not found. Operator: seed via 'npm run import-book' or SQL INSERT.`,
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

  // ─── Zip processing (pure-ish: parse, validate, hash) ───────────────────
  const processed = await processZipUpload(buffer, formFields);
  if (processed.kind === "rejected") {
    return jsonError(processed.status, processed.error, processed.code);
  }

  // ─── Pre-tx peek for existing skill (informs Stripe decision only) ──────
  const peeked = await prisma.skill.findUnique({
    where: { publisherId_slug: { publisherId: publisher.id, slug: processed.slug } },
    select: {
      id: true,
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: {
          id: true,
          version: true,
          normalizedHash: true,
        },
      },
    },
  });

  // ─── Idempotency short-circuit ──────────────────────────────────────────
  // Skill hashes are stored directly on the row — no need to re-load + re-
  // concat files like books do.
  if (peeked?.versions[0]) {
    if (peeked.versions[0].normalizedHash === processed.normalizedHash) {
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

  // ─── Stripe create (NEW-SKILL BRANCH ONLY; pre-tx per D11.7) ────────────
  let stripeProductId: string | undefined;
  let stripePriceId: string | undefined;
  if (!peeked) {
    if (formFields.priceUsdCents == null || formFields.priceUsdCents < STRIPE_MIN_CENTS) {
      return jsonError(
        400,
        `price_usd_cents must be an integer >= ${STRIPE_MIN_CENTS} (Stripe USD minimum) for new skills`,
        "MISSING_REQUIRED_FIELD",
      );
    }
    try {
      const product = await stripe.products.create({
        name: processed.name,
        description: processed.description,
        metadata: { skill_id: processed.skillIdIfNew, skill_slug: processed.slug },
      });
      stripeProductId = product.id;
      const price = await stripe.prices.create({
        product: stripeProductId,
        unit_amount: formFields.priceUsdCents,
        currency: "usd",
        metadata: { skill_id: processed.skillIdIfNew, skill_slug: processed.slug },
      });
      stripePriceId = price.id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown Stripe error";
      console.error(`[skills/new] Stripe step failed: ${msg}`);
      return jsonError(502, `Stripe error: ${msg}`);
    }
  }

  // ─── Interactive transaction (D12.4) ────────────────────────────────────
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Authoritative re-resolve (TOCTOU per Stream K T1).
      const existing = await tx.skill.findUnique({
        where: { publisherId_slug: { publisherId: publisher.id, slug: processed.slug } },
        select: {
          id: true,
          versions: { orderBy: { version: "desc" }, take: 1, select: { version: true } },
        },
      });

      if (existing && !peeked) {
        throw Object.assign(new Error("RACE_DETECTED_NEW_TO_EXISTING"), { __race: true as const });
      }
      if (!existing && peeked) {
        throw Object.assign(new Error("RACE_DETECTED_EXISTING_TO_NEW"), { __race: true as const });
      }

      let skillId: string;
      let nextVersion: number;
      let beforeVersion: number | null;

      if (existing) {
        skillId = existing.id;
        beforeVersion = existing.versions[0]?.version ?? null;
        nextVersion = (beforeVersion ?? 0) + 1;
      } else {
        skillId = processed.skillIdIfNew;
        beforeVersion = null;
        nextVersion = 1;
        await tx.skill.create({
          data: {
            id: skillId,
            publisherId: publisher.id,
            publisherUserId: actorUserId,
            slug: processed.slug,
            name: processed.name,
            description: processed.description,
          },
        });
        await tx.skillPrice.create({
          data: {
            skillId,
            currency: "USD",
            unitAmountCents: formFields.priceUsdCents!,
            stripePriceId: stripePriceId!,
          },
        });
        // PUBLISHER_OWN grant on the skill (XOR-checked: bookId NULL, skillId set).
        await tx.accessGrant.createMany({
          data: [{ subscriberId: subscriber.id, skillId, source: GrantSource.PUBLISHER_OWN }],
          skipDuplicates: true,
        });
      }

      const versionId = processed.skillVersionId;
      await tx.skillVersion.create({
        data: {
          id: versionId,
          skillId,
          version: nextVersion,
          byteSize: processed.totalBytes,
          manifest: processed.manifestJson as Prisma.InputJsonValue,
          normalizedHash: processed.normalizedHash,
          virtualRoot: processed.virtualRoot,
        },
      });
      await tx.skillFile.createMany({
        data: processed.files.map((f) => ({
          skillVersionId: versionId,
          order: f.order,
          path: f.path,
          extension: f.extension,
          content: f.content,
          byteSize: f.byteSize,
          contentHash: f.contentHash,
        })),
      });

      await writeAuditEntry(tx, {
        actorUserId,
        actionType: "skill.zip_upload",
        targetType: "skill",
        targetId: skillId,
        beforeState: { existing_version: beforeVersion },
        afterState: {
          new_version: nextVersion,
          file_count: processed.files.length,
          // Skills always have a manifest (SKILL.md frontmatter is required);
          // field is here for parity with the book audit row, always true.
          manifest_present: true,
          total_bytes: processed.totalBytes,
          virtual_root: processed.virtualRoot,
          slug_source: processed.slugSource,
        },
      });

      return {
        id: skillId,
        slug: processed.slug,
        version: nextVersion,
        fileCount: processed.files.length,
        created: !existing,
      };
    });

    // Best-effort post-tx Stripe metadata refresh (new-skill path only).
    if (result.created && stripeProductId) {
      try {
        await stripe.products.update(stripeProductId, {
          metadata: { skill_id: result.id, skill_slug: result.slug },
        });
      } catch (err) {
        console.warn(
          `[skills/new] Stripe metadata refresh failed (non-fatal): product=${stripeProductId} ${err instanceof Error ? err.message : err}`,
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
        `[skills/new] Race detected: peek saw no skill but tx found one. ORPHAN Stripe IDs: product=${stripeProductId} price=${stripePriceId}. metadata.skill_slug=${processed.slug}.`,
      );
      return NextResponse.json(
        {
          error: `Slug '${processed.slug}' was claimed by a concurrent upload between the slug-check and the write. Retry the upload — the next attempt will see the existing skill and add a new version.`,
          code: "RACE_DETECTED",
          orphanStripeProductId: stripeProductId,
          orphanStripePriceId: stripePriceId,
          recovery:
            "The Stripe Product+Price were pre-allocated for what looked like a new skill but the slug now exists. Retry the upload (it will fall through to the new-version path and skip Stripe). If the operator needs to clean up the orphan Product, see docs/operations.md 'Stream B partial-failure recovery' — same shape applies to the skill new-skill branch.",
        },
        { status: 409 },
      );
    }
    if (isRace) {
      return jsonError(409, msg, "RACE_DETECTED");
    }

    if (!peeked && stripeProductId && stripePriceId) {
      console.error(
        `[skills/new] Local TX failed AFTER Stripe Product+Price created. ORPHAN: product=${stripeProductId} price=${stripePriceId}. Error: ${msg}`,
      );
      return NextResponse.json(
        {
          error: `Local transaction failed: ${msg}`,
          orphanStripeProductId: stripeProductId,
          orphanStripePriceId: stripePriceId,
          recovery:
            "See docs/operations.md 'Stream B — new book published with Stripe Product/Price success but local TX failure'. The same recovery path applies to the skill new-skill branch.",
        },
        { status: 500 },
      );
    }
    return jsonError(500, `Local transaction failed: ${msg}`);
  }
}
