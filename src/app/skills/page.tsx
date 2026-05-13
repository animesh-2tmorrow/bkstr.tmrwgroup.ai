// Phase 6 Stream L (D18.1) — public skills listing, thin analog of /storefront
// for books. Server component, direct prisma access (matches the dashboard
// pattern; /storefront itself is client-side for now because of the bigger
// per-card interactions — the L MVP is simpler).

import Link from "next/link";
import { prisma } from "@/lib/db";

export const metadata = { title: "Skills | bkstr" };
export const dynamic = "force-dynamic";

export default async function SkillsListingPage() {
  const skills = await prisma.skill.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      price: { select: { unitAmountCents: true } },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="min-h-screen bg-[#FAF6EC] text-gray-900">
      <header className="border-b border-[#E5DCC8] px-6 py-5">
        <div className="max-w-7xl mx-auto flex justify-between items-baseline">
          <Link href="/" className="text-xl font-bold italic text-gray-900">
            bkstr.tmrwgroup.ai
          </Link>
          <nav className="text-sm flex gap-4 text-gray-500">
            <Link href="/storefront" className="hover:text-gray-900">Books</Link>
            <Link href="/skills" className="text-gray-900 font-semibold">Skills</Link>
            <Link href="/about" className="hover:text-gray-900">About</Link>
            <Link href="/login" className="hover:text-gray-900">Log in</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10">
        <section className="mb-8">
          <h1 className="text-3xl font-serif font-bold tracking-tight">Skills</h1>
          <p className="text-sm text-gray-600 mt-2 max-w-2xl">
            Bundled instruction sets your agents install once and use to consume bkstr content.
            Each skill ships as a <code>.zip</code> containing a <code>SKILL.md</code> + supporting files.
          </p>
        </section>

        {skills.length === 0 ? (
          <div className="rounded-lg border border-[#E5DCC8] bg-white p-8 text-center text-sm text-gray-500">
            No skills published yet.{" "}
            <Link href="/dashboard/books/new" className="font-semibold underline text-gray-900">
              Publishers: upload one.
            </Link>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
            {skills.map((s) => {
              const priceCents = s.price?.unitAmountCents ?? null;
              const priceLabel =
                priceCents != null ? `$${(priceCents / 100).toFixed(2)}` : "—";
              return (
                <article
                  key={s.id}
                  className="rounded-lg border border-[#E5DCC8] bg-white overflow-hidden flex flex-col"
                >
                  <div className="p-6 flex-1">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500 bg-[#EAE2D0] inline-block px-1.5 py-0.5 rounded mb-2">
                      Skill
                    </div>
                    <h2 className="font-serif font-bold text-lg text-gray-900">{s.name}</h2>
                    <p className="text-sm text-gray-600 mt-2 line-clamp-3">
                      {s.description || "No description yet."}
                    </p>
                    <p className="text-sm font-bold text-gray-900 mt-4">{priceLabel}</p>
                    <p className="text-xs text-gray-500">One-time purchase</p>
                  </div>
                  <Link
                    href={`/skills/${encodeURIComponent(s.slug)}`}
                    className="block bg-[#0D1B2A] hover:bg-[#051B2A] text-white text-center py-3 text-sm font-bold"
                  >
                    View details
                  </Link>
                </article>
              );
            })}
          </div>
        )}
      </main>

      <footer className="border-t border-[#E5DCC8] py-8 px-6 mt-12">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-gray-400">
          <span>&copy; 2026 Tmrwgroup. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
}
