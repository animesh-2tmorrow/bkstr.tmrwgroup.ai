// Phase 6 Stream L (D18.1) — public skill detail page. Renders name + description
// + file list (paths only — file CONTENTS are behind purchase, only delivered via
// /api/skills/[slug]/download) + price + Buy/Already-owned/Sign-in CTA.

import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SkillBuyButton } from "./buy-button";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return { title: `${slug} | Skills | bkstr` };
}

export default async function SkillDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Resolve the skill by slug, including its latest version's file paths
  // (paths only — we never render content on the public detail page; that's
  // behind purchase via /api/skills/[slug]/download).
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
  const priceLabel = priceCents != null ? `$${(priceCents / 100).toFixed(2)}` : "—";
  const latestVersion = skill.versions[0];

  // Check whether the current viewer already owns this skill — if so, show
  // "Download" instead of "Buy" (purchase flow is gated by an existing-grant
  // check anyway, but the UI should reflect ownership state proactively).
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
    <div className="min-h-screen bg-[#FAF6EC] text-gray-900">
      <header className="border-b border-[#E5DCC8] px-6 py-5">
        <div className="max-w-7xl mx-auto flex justify-between items-baseline">
          <Link href="/" className="text-xl font-bold italic text-gray-900">
            bkstr.tmrwgroup.ai
          </Link>
          <nav className="text-sm flex gap-4 text-gray-500">
            <Link href="/storefront" className="hover:text-gray-900">Books</Link>
            <Link href="/skills" className="hover:text-gray-900">Skills</Link>
            <Link href="/about" className="hover:text-gray-900">About</Link>
            <Link href="/login" className="hover:text-gray-900">Log in</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        <Link href="/skills" className="text-sm text-gray-500 hover:text-gray-900">
          ← All skills
        </Link>

        <article className="mt-4 rounded-lg border border-[#E5DCC8] bg-white overflow-hidden">
          <div className="p-8">
            <div className="text-[10px] uppercase tracking-wide text-gray-500 bg-[#EAE2D0] inline-block px-1.5 py-0.5 rounded mb-2">
              Skill
            </div>
            <h1 className="font-serif font-bold text-3xl text-gray-900">{skill.name}</h1>
            <p className="text-base text-gray-700 mt-3 leading-relaxed">
              {skill.description || "No description yet."}
            </p>
            <p className="text-lg font-bold text-gray-900 mt-6">{priceLabel}</p>
            <p className="text-xs text-gray-500">One-time purchase</p>
          </div>

          <div className="border-t border-[#E5DCC8] p-8 bg-[#F5F0E4]">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">
              Files (v{latestVersion?.version ?? "?"})
            </h2>
            <p className="text-xs text-gray-500 mb-3">
              File contents are delivered as a single <code>.zip</code> after purchase. The list
              below is the manifest — paths and sizes only.
            </p>
            <ul className="text-sm font-mono space-y-1">
              {latestVersion?.files.map((f) => (
                <li key={f.path} className="flex justify-between text-gray-700">
                  <span>{f.path}</span>
                  <span className="text-gray-400 text-xs">{(f.byteSize / 1024).toFixed(1)} KB</span>
                </li>
              ))}
            </ul>
          </div>

          <SkillBuyButton
            skillId={skill.id}
            slug={skill.slug}
            priceCents={priceCents}
            alreadyOwns={alreadyOwns}
            signedIn={session?.user?.email != null}
          />
        </article>
      </main>
    </div>
  );
}
