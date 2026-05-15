// bkstr redesign PR 4 — public skill detail page.
//
// Reskin of Stream L's L-MVP detail (rounded white card + navy CTA).
// New look: Masthead chrome, eyebrow + display-serif name, paper card
// with description + price + file manifest (defaultOpen) + buy CTA.
//
// File contents stay behind purchase — only paths + sizes render here;
// downloads land via /api/skills/[slug]/download (Stream L) authenticated
// by the existing AccessGrant lookup.

import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SkillBuyButton } from "./buy-button";
import { SkillFilesDetails } from "@/components/skills/skill-files-details";
import {
  Masthead,
  MarketingFooter,
  Eyebrow,
  Pill,
} from "@/components/design";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return { title: `${slug} | Skills | bkstr` };
}

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

export default async function SkillDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const skill = await prisma.skill.findFirst({
    where: { slug, status: "ACTIVE" },
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
  });
  if (!skill) notFound();

  const priceCents = skill.price?.unitAmountCents ?? null;
  const latestVersion = skill.versions[0];
  const fileCount = latestVersion?.files.length ?? 0;

  // Already-owns check — shows Download instead of Buy when the viewer
  // has an active AccessGrant for this skill.
  const session = await auth();
  let alreadyOwns = false;
  if (session?.user?.email) {
    const subscriber = await prisma.subscriber.findFirst({
      where: { user: { email: session.user.email } },
      select: { id: true },
    });
    if (subscriber) {
      const grant = await prisma.accessGrant.findFirst({
        where: {
          subscriberId: subscriber.id,
          skillId: skill.id,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { id: true },
      });
      alreadyOwns = grant !== null;
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-paper">
      <Masthead navItems={MASTHEAD_NAV} />

      <main className="flex-grow max-w-4xl mx-auto px-8 w-full pt-10 pb-14">
        <Link
          href="/skills"
          className="font-mono text-[11px] uppercase tracking-eyebrow text-ink-3 hover:text-ink"
        >
          ← All skills
        </Link>

        <article className="mt-6 bg-paper border border-rule">
          {/* Header pane */}
          <div className="p-10">
            <Pill variant="saffron" className="mb-3">
              SKILL · .zip
            </Pill>
            <h1 className="font-serif text-[clamp(36px,5vw,48px)] leading-[1.05] tracking-display text-ink m-0">
              {skill.name}
            </h1>
            <p className="text-base text-ink-2 mt-4 leading-[1.65]">
              {skill.description || "No description yet."}
            </p>
            <div className="flex items-baseline gap-6 mt-8">
              <div>
                <div className="font-serif text-[34px] tracking-display text-ink num leading-none">
                  {formatPrice(priceCents)}
                  <span className="text-ink-3 text-base">.00</span>
                </div>
                <Eyebrow className="mt-2 block">ONE-TIME PURCHASE</Eyebrow>
              </div>
              <div aria-hidden className="w-px h-12 bg-rule" />
              <div>
                <div className="font-mono text-[15px] text-ink-2 num">
                  v{latestVersion?.version ?? "?"}
                </div>
                <Eyebrow className="mt-2 block">LATEST VERSION</Eyebrow>
              </div>
              <div aria-hidden className="w-px h-12 bg-rule" />
              <div>
                <div className="font-mono text-[15px] text-ink-2 num">
                  {fileCount}
                </div>
                <Eyebrow className="mt-2 block">
                  {fileCount === 1 ? "FILE" : "FILES"}
                </Eyebrow>
              </div>
            </div>
          </div>

          {/* File manifest pane — paths + sizes only; contents are behind
              purchase per Stream L. defaultOpen=true so the manifest is
              the visual centerpiece on the detail page. */}
          <div className="border-t border-rule p-10 bg-paper-2">
            <Eyebrow className="block mb-2">
              § FILES (V{latestVersion?.version ?? "?"})
            </Eyebrow>
            <p className="text-xs text-ink-3 mb-4 max-w-[60ch]">
              File contents are delivered as a single{" "}
              <code className="font-mono">.zip</code> after purchase. The list
              below is the manifest — paths and sizes only.
            </p>
            {fileCount > 0 ? (
              <SkillFilesDetails
                files={latestVersion!.files}
                defaultOpen
              />
            ) : (
              <p className="text-ink-3 text-sm">No files in this version.</p>
            )}
          </div>

          {/* CTA — buy / download / sign-in (client component). */}
          <div className="border-t border-rule">
            <SkillBuyButton
              skillId={skill.id}
              slug={skill.slug}
              priceCents={priceCents}
              alreadyOwns={alreadyOwns}
              signedIn={session?.user?.email != null}
            />
          </div>
        </article>
      </main>

      <MarketingFooter />
    </div>
  );
}
