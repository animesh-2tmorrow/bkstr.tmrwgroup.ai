import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashShell, Eyebrow, StatCard } from "@/components/design";
import { BooksTable } from "@/components/dashboard/books-table";
import {
  getBooksWithMetrics,
  getBookAccessStates,
  getBooksFetchSparklines,
  getDashboardStats,
} from "@/lib/dashboard/queries";
import { buildDashNav } from "@/lib/dashboard/nav-config";

// bkstr redesign PR 3 — Active Books page on the new <DashShell>.
//
// Header: § ACTV BKS · COMPRESSED KNWLDGE FOR YR FLEET eyebrow + serif h1
// + intro copy. Below: 4-stat strip (Volumes Owned / Fetches 30d /
// Active Agents / Tokens Served 30d) + table with per-book sparklines.
//
// Migrated off the OLD src/components/dashboard/dashboard-shell.tsx to
// the new <DashShell> primitive (PR 0). Other dashboard surfaces still
// use the old shell until PR 5/6/7 migrate them. Both shells coexist
// during the migration; deletion of the old happens once every page is
// on the new one.

export const metadata = { title: "Active Books | bkstr" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const subscriber = await prisma.subscriber.findFirst({
    where: { user: { email: session.user.email } },
    select: { id: true, companyName: true },
  });
  const companyName = subscriber?.companyName ?? "Personal";
  const userEmail = session.user.email;

  // Five queries in parallel — books / per-subscriber access / per-book
  // sparklines / dashboard stats. The stats query is subscriber-scoped;
  // sparklines are global (the table renders rows for every book).
  const [books, accessByBook, sparklinesByBook, stats] = await Promise.all([
    getBooksWithMetrics(),
    subscriber ? getBookAccessStates(subscriber.id) : Promise.resolve(undefined),
    getBooksFetchSparklines(),
    subscriber
      ? getDashboardStats(subscriber.id)
      : Promise.resolve({
          volumesOwned: 0,
          fetches30d: 0,
          activeAgents30d: 0,
          tokensServed30d: 0,
        }),
  ]);

  // Tokens-served formatting: prefer "M" / "k" suffixes for large numbers.
  // Reference dashboard.jsx:151 shows "2.1M". Keep consistent here.
  const tokensFmt = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  };

  return (
    <DashShell
      nav={buildDashNav(session.user.role, "/dashboard")}
      brandSubtitle={companyName.toUpperCase()}
      userBlock={<UserBlock email={userEmail} />}
    >
      {/* Header */}
      <div className="flex justify-between items-end gap-6 mb-8">
        <div>
          <Eyebrow>§ ACTV BKS · COMPRESSED KNWLDGE FOR YR FLEET</Eyebrow>
          <h1 className="font-serif font-normal text-[36px] leading-[1.05] tracking-display text-ink mt-3 mb-2">
            Active Books
          </h1>
          <p className="text-ink-3 text-sm max-w-[60ch]">
            Volumes your agent fleet is currently licensed to fetch. Click any
            title to inspect fetch logs, rotate access, or buy a new shelf.
          </p>
        </div>
      </div>

      {/* Stat strip — 4 cards, hairline-separated grid (1px rule between) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-rule mb-8">
        <StatCard
          label="VOLUMES OWNED"
          value={stats.volumesOwned}
          delta={stats.volumesOwned > 0 ? "of the catalog" : "none yet"}
          className="border-0"
        />
        <StatCard
          label="FETCHES · 30D"
          value={stats.fetches30d.toLocaleString()}
          delta="across your fleet"
          className="border-0"
        />
        <StatCard
          label="ACTIVE AGENTS"
          value={stats.activeAgents30d}
          delta="distinct API keys, 30d"
          className="border-0"
        />
        <StatCard
          label="TOKENS SERVED · 30D"
          value={tokensFmt(stats.tokensServed30d)}
          delta="output tokens streamed"
          className="border-0"
        />
      </div>

      <BooksTable
        books={books}
        accessByBook={accessByBook}
        sparklinesByBook={sparklinesByBook}
      />
    </DashShell>
  );
}

function UserBlock({ email }: { email: string }) {
  return (
    <>
      <div className="text-ink text-[13px] mb-1 truncate">{email}</div>
      <div className="flex justify-between items-center text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="w-1.5 h-1.5 rounded-full bg-status-ok inline-block"
          />
          Signed in
        </span>
        <a
          href="/api/auth/signout"
          className="text-ink-3 hover:text-ink transition-colors"
        >
          Log out
        </a>
      </div>
    </>
  );
}
