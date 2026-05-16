// redesign(10) Phase 2 — unified storefront detail page.
//
// Server component. Resolves slug via the Phase 1 resolveSlug() helper —
// returns a discriminated-union ResolvedItem for either kind. 404s on null
// (slug not in catalog or not ACTIVE).
//
// Layout:
//   Masthead chrome (same nav as /storefront)
//   [← All catalog] breadcrumb
//   [BOOK · domain pill] or [SKILL · .zip pill]   eyebrow
//   Title (serif 36-48px clamp)
//   Description prose
//   §ABOUT — Price · Latest Version · Files (3 baseline-aligned stats)
//   BuyButton (top — 4-state; for owned, scrolls to #get-started)
//   §FILES (V<n>)   <FilesDetails defaultOpen>
//   If owned:
//     §GET STARTED                             <- anchor target
//     "Where to put these files" prose
//     <ApiInstructionsBlock kind={kind} ...>
//     Q&A docs link (operator decision 7.2 — both library disclosure + docs)
//   Else:
//     BuyButton (second instance — post-manifest CTA per dispatch)
//   MarketingFooter
//
// Books vs skills divergence is mostly in the eyebrow pill, the description
// length, and the presence of the Q&A endpoint in the Get Started panel.
// Cover treatment: books get a BookCover SVG above the title (matches the
// existing skill detail page's visual rhythm — the skill detail page has
// no cover, mirroring HANDOFF.md "books-only palette + glyph" Q4).
//
// /skills/[slug] continues to serve the old detail page during Phase 2;
// Phase 3 migrates it to a 308 redirect into /storefront/[slug] and
// deletes the old file.

import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveSlug } from "@/lib/storefront/resolve-slug";
import { getAccessStatesForCatalog } from "@/lib/dashboard/queries";
import { BuyButton, type BuyButtonState } from "@/components/storefront/buy-button";
import { FilesDetails } from "@/components/storefront/files-details";
import { ApiInstructionsBlock } from "@/components/dashboard/api-instructions-block";
import {
  Masthead,
  MarketingFooter,
  Eyebrow,
  Pill,
  BookCover,
} from "@/components/design";
import type { BookCoverPalette } from "@/components/design/book-cover";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return { title: `${slug} | bkstr` };
}

const MASTHEAD_NAV = [
  { label: "Home", href: "/" },
  { label: "Catalog", href: "/storefront", active: true },
  // redesign(10)/3 — Skills entry removed. /skills is a 308 redirect
  // to /storefront from this phase forward. Books + skills share the
  // unified catalog.
  // get-started(d) — "Get started" inserted between Catalog and Docs,
  // matching the homepage + /storefront masthead arrays.
  { label: "Get started", href: "/get-started" },
  { label: "Docs", href: "/dashboard/docs" },
  { label: "Log in", href: "/login" },
];

function formatPrice(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(0)}`;
}

function humanDomain(domain: string): string {
  // Same heuristic as /storefront grid — uppercase common acronyms,
  // title-case the rest.
  return domain
    .split(/[-_\s]+/)
    .map((word) => {
      const upper = ["ci", "cd", "api", "aws", "tdd", "qa", "ui", "ux", "ai", "ml"];
      return upper.includes(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

export default async function StorefrontDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const item = await resolveSlug(slug);
  if (!item) notFound();

  // Per-subscriber access state (for the BuyButton). Anonymous viewers get
  // state="anon"; signed-in viewers get state derived from the access map.
  // The single-item lookup uses the catalog-wide map for now — small N
  // means this is cheap (Phase 1 verification showed 11 items total).
  const session = await auth();
  let buyState: BuyButtonState = item.unitAmountCents == null ? "no_price" : "for_sale";
  let subscriberId: string | null = null;
  let apiKey: { prefix: string; name: string } | null = null;

  if (session?.user?.email) {
    const subscriber = await prisma.subscriber.findFirst({
      where: { user: { email: session.user.email } },
      select: { id: true },
    });
    if (subscriber) {
      subscriberId = subscriber.id;
      const map = await getAccessStatesForCatalog(subscriber.id);
      const entry = map.get(`${item.kind}:${item.id}`);
      if (entry?.state === "granted") {
        buyState = "owned";
      } else if (entry?.state === "for_sale") {
        buyState = "for_sale";
      } else {
        buyState = item.unitAmountCents == null ? "no_price" : "for_sale";
      }
      // Look up the most recent active api-key so the Get Started panel
      // shows a masked key inline (instead of "Generate an API key first").
      if (buyState === "owned") {
        const row = await prisma.subscriberApiKey.findFirst({
          where: { subscriberId: subscriber.id, revokedAt: null },
          orderBy: { createdAt: "desc" },
          select: { keyPrefix: true, name: true },
        });
        if (row) apiKey = { prefix: row.keyPrefix, name: row.name };
      }
    }
  } else {
    buyState = "anon";
  }

  const fileCount = item.files.length;
  const isOwned = buyState === "owned";

  return (
    <div className="min-h-screen flex flex-col bg-paper">
      <Masthead navItems={MASTHEAD_NAV} />

      <main className="flex-grow max-w-4xl mx-auto px-8 w-full pt-10 pb-14">
        <Link
          href="/storefront"
          className="font-mono text-[11px] uppercase tracking-eyebrow text-ink-3 hover:text-ink"
        >
          ← All catalog
        </Link>

        <article className="mt-6 bg-paper border border-rule">
          {/* HEADER PANE — eyebrow pill + title + description + 3 stats */}
          <div className="p-10">
            {item.kind === "book" && item.domain ? (
              <Pill variant="saffron" className="mb-3">
                BOOK · {humanDomain(item.domain).toUpperCase()}
              </Pill>
            ) : (
              <Pill variant="saffron" className="mb-3">
                SKILL · .zip
              </Pill>
            )}

            {/* redesign(10)/6 — BookCover renders for both kinds. Skills
                pass "SKILL" as the imprint-bar domain since they don't
                carry one; books pass their actual domain. Gate dropped
                the `kind === "book"` clause because palette+glyph are
                now non-null for both kinds (derived deterministically
                for skills via deriveSkillCover(slug, name)). The HANDOFF
                Q4 "typographic-mono" treatment for skills was reversed
                in this phase. */}
            {item.palette && item.glyph && (
              <div className="float-right ml-8 mb-4 hidden md:block">
                <BookCover
                  book={{
                    title: item.displayName,
                    glyph: item.glyph,
                    domain: item.domain ?? "SKILL",
                    palette: item.palette as BookCoverPalette,
                    vol: "Vol. 01",
                    version: `v${item.latestVersion}`,
                    author: "—",
                  }}
                  size="md"
                />
              </div>
            )}

            <h1 className="font-serif text-[clamp(36px,5vw,48px)] leading-[1.05] tracking-display text-ink m-0">
              {item.displayName}
            </h1>
            <p className="text-base text-ink-2 mt-4 leading-[1.65] clear-both">
              {item.description || "No description yet."}
            </p>

            <div className="flex items-baseline gap-6 mt-8 clear-both">
              <div>
                <div className="font-serif text-[34px] tracking-display text-ink num leading-none">
                  {formatPrice(item.unitAmountCents)}
                  <span className="text-ink-3 text-base">.00</span>
                </div>
                <Eyebrow className="mt-2 block">ONE-TIME PURCHASE</Eyebrow>
              </div>
              <div aria-hidden className="w-px h-12 bg-rule" />
              <div>
                <div className="font-mono text-[15px] text-ink-2 num">
                  v{item.latestVersion || "?"}
                </div>
                <Eyebrow className="mt-2 block">LATEST VERSION</Eyebrow>
              </div>
              <div aria-hidden className="w-px h-12 bg-rule" />
              <div>
                <div className="font-mono text-[15px] text-ink-2 num">
                  {fileCount}
                </div>
                <Eyebrow className="mt-2 block">
                  {fileCount === 1
                    ? item.kind === "book"
                      ? "CHAPTER"
                      : "FILE"
                    : item.kind === "book"
                      ? "CHAPTERS"
                      : "FILES"}
                </Eyebrow>
              </div>
            </div>
          </div>

          {/* TOP CTA — primary buy button or scroll-to-anchor for owners */}
          <div className="border-t border-rule">
            <BuyButton
              kind={item.kind}
              itemId={item.id}
              itemSlug={item.slug}
              unitAmountCents={item.unitAmountCents}
              stripePriceId={item.stripePriceId}
              state={buyState}
            />
          </div>

          {/* FILE MANIFEST */}
          <div className="border-t border-rule p-10 bg-paper-2">
            <Eyebrow className="block mb-2">
              § {item.kind === "book" ? "CHAPTERS" : "FILES"} (V
              {item.latestVersion || "?"})
            </Eyebrow>
            <p className="text-xs text-ink-3 mb-4 max-w-[60ch]">
              {item.kind === "book" ? (
                <>
                  Chapter list with paths and sizes. After purchase, install
                  the whole book with one command —{" "}
                  <code className="font-mono">
                    curl -sL …/api/install/{item.slug} | tar xz
                  </code>{" "}
                  — see Get Started below.
                </>
              ) : (
                <>
                  The list below is the manifest — paths and sizes only.
                  After purchase, install the whole skill with one command —{" "}
                  <code className="font-mono">
                    curl -sL …/api/install/{item.slug} | tar xz
                  </code>{" "}
                  — see Get Started below.
                </>
              )}
            </p>
            {fileCount > 0 ? (
              <FilesDetails
                files={item.files}
                defaultOpen
                title={
                  item.kind === "book" ? "BOOK CHAPTERS" : "ARCHIVE CONTENTS"
                }
              />
            ) : (
              <p className="text-ink-3 text-sm">
                No {item.kind === "book" ? "chapters" : "files"} in this
                version yet.
              </p>
            )}
          </div>

          {/* OWNED → Get Started panel inline. Pre-purchase → second BuyButton. */}
          {isOwned ? (
            <section
              id="get-started"
              className="border-t border-rule p-10 bg-paper"
            >
              <Eyebrow className="block mb-2">§ GET STARTED</Eyebrow>
              <h2 className="font-serif text-[28px] tracking-display text-ink m-0 mb-3">
                You own this {item.kind}.
              </h2>
              <p className="text-ink-2 text-sm leading-[1.6] mb-5 max-w-[64ch]">
                You own this {item.kind} — install it with the single command
                below. It fetches the bundle and unpacks it under{" "}
                <code className="font-mono">
                  ~/.claude/skills/{item.slug}/
                </code>
                . The raw per-file JSON endpoint stays available under
                &ldquo;Advanced&rdquo; in the block.
              </p>

              {/* The instructions block carries the masked api-key + the
                  primary files-endpoint curl + (for books) the collapsed
                  Q&A advanced disclosure. */}
              <ApiInstructionsBlock
                kind={item.kind}
                itemId={item.id}
                itemSlug={item.slug}
                subscriberId={subscriberId ?? ""}
                apiKey={apiKey?.prefix ?? ""}
                isFree={
                  item.unitAmountCents == null || item.unitAmountCents === 0
                }
              />

              {/* Operator decision 7.2 — also link to /dashboard/docs from
                  the detail page panel (the library row's disclosure
                  carries the collapsed advanced block; the docs page
                  carries the long-form treatment). Books only — skills
                  have no Q&A endpoint. */}
              {item.kind === "book" && (
                <p className="text-xs text-ink-3 mt-5">
                  Looking for the Q&A endpoint?{" "}
                  <Link
                    href="/dashboard/docs"
                    className="text-ink underline hover:no-underline"
                  >
                    Read the docs →
                  </Link>{" "}
                  for the full Q&A flow + caveats.
                </p>
              )}
            </section>
          ) : (
            // Pre-purchase: second BuyButton after the manifest (dispatch:
            // "two CTAs — first impression + after reading").
            <div className="border-t border-rule">
              <BuyButton
                kind={item.kind}
                itemId={item.id}
                itemSlug={item.slug}
                unitAmountCents={item.unitAmountCents}
                stripePriceId={item.stripePriceId}
                state={buyState}
              />
            </div>
          )}
        </article>
      </main>

      <MarketingFooter />
    </div>
  );
}
