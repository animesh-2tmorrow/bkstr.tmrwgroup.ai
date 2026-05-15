// bkstr redesign PR 4 — public skills listing.
//
// Reskin of the Stream L L-MVP listing (rounded-card grid + navy CTAs).
// New look: editorial Masthead chrome shared with /storefront, eyebrow +
// display-serif heading, 2-up card grid with mono-style title, expandable
// file list, design-system Button. Marketing footer at the bottom.
//
// Skills don't have palette/glyph (operator Q4: books-only) — cards stay
// typographic-mono with no <BookCover> SVG. Per-card metadata is limited
// to what production schema actually carries today (name, description,
// price, version, file count). Author/fetches/deps from the reference's
// data.jsx are NOT in production today; flagged as a future enrichment
// (fetch tracking is partially blocked on follow-up #128's fetch_logs
// polymorphism).

import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  Masthead,
  MarketingFooter,
  Eyebrow,
  Pill,
  Button,
} from "@/components/design";
import { SkillFilesDetails } from "@/components/skills/skill-files-details";

export const metadata = { title: "Skills | bkstr" };
export const dynamic = "force-dynamic";

const MASTHEAD_NAV = [
  { label: "Home", href: "/" },
  { label: "Catalog", href: "/storefront" },
  { label: "Skills", href: "/skills", active: true },
  { label: "Docs", href: "/dashboard/docs" },
  { label: "Log in", href: "/login" },
];

function formatPrice(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(0)}`;
}

export default async function SkillsListingPage() {
  const skills = await prisma.skill
    .findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        price: { select: { unitAmountCents: true } },
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: {
            version: true,
            createdAt: true,
            files: {
              orderBy: { order: "asc" },
              select: { path: true, extension: true, byteSize: true },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    })
    .catch(() => []);

  return (
    <div className="min-h-screen flex flex-col bg-paper">
      <Masthead navItems={MASTHEAD_NAV} />

      <main className="flex-grow max-w-[1280px] mx-auto px-8 w-full pt-14 pb-14">
        <section className="mb-12 max-w-[72ch]">
          <Eyebrow>§ SKLLS · BUNDLED INSTRUCTION SETS</Eyebrow>
          <h1 className="font-serif text-[clamp(36px,4.4vw,56px)] leading-[1.05] tracking-display m-0 mt-3">
            Skills
          </h1>
          <p className="text-ink-3 text-base leading-[1.6] mt-4">
            Bundled instruction sets your agents install once and use to
            consume bkstr content. Each skill ships as a{" "}
            <code className="font-mono bg-paper-2 px-1.5 py-0.5 border border-rule text-saffron-dk">
              .zip
            </code>{" "}
            containing a{" "}
            <code className="font-mono bg-paper-2 px-1.5 py-0.5 border border-rule text-saffron-dk">
              SKILL.md
            </code>{" "}
            + supporting files. Buy once, install per agent, no recurring cost.
          </p>
        </section>

        {skills.length === 0 ? (
          <div className="bg-paper border border-rule p-10 text-center">
            <p className="text-ink-3 text-sm">
              No skills published yet.{" "}
              <Link
                href="/dashboard/books/new"
                className="text-ink underline hover:no-underline"
              >
                Publishers: upload one →
              </Link>
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {skills.map((s) => {
              const priceCents = s.price?.unitAmountCents ?? null;
              const latest = s.versions[0];
              const fileCount = latest?.files.length ?? 0;
              return (
                <article
                  key={s.id}
                  className="bg-paper border border-rule p-6 flex flex-col gap-4"
                >
                  {/* Top row: pill + price */}
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex flex-col gap-2 min-w-0">
                      <Pill variant="saffron" className="self-start">
                        SKILL · .zip
                      </Pill>
                      <h2 className="font-serif text-[26px] tracking-tight text-ink m-0 truncate">
                        {s.name}
                      </h2>
                      <div className="font-mono text-[11px] text-ink-3">
                        v{latest?.version ?? "?"} · {fileCount}{" "}
                        {fileCount === 1 ? "file" : "files"}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-serif text-[26px] text-ink num">
                        {formatPrice(priceCents)}
                        <span className="text-ink-3 text-xs">.00</span>
                      </div>
                      <Eyebrow>ONE-TIME</Eyebrow>
                    </div>
                  </div>

                  <p className="text-ink-2 text-sm leading-[1.55] m-0 line-clamp-3">
                    {s.description || "No description yet."}
                  </p>

                  {/* Expandable file list — server-rendered <details>; no
                      client JS needed. Component encapsulates the disclosure
                      shape so it's reusable on the detail page. */}
                  {fileCount > 0 ? (
                    <SkillFilesDetails files={latest!.files} />
                  ) : null}

                  <div className="flex gap-2.5 mt-auto">
                    <Button as="a" href={`/skills/${encodeURIComponent(s.slug)}`} className="flex-1">
                      View details →
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      <MarketingFooter />
    </div>
  );
}
