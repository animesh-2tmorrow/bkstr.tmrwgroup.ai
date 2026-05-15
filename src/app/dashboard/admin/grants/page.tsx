import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashShell, Eyebrow } from "@/components/design";
import { AdminGrantsTable } from "@/components/dashboard/admin/admin-grants-table";
import { getAdminGrants } from "@/lib/dashboard/queries";
import { GrantSource } from "@/generated/prisma/client";
import { buildDashNav } from "@/lib/dashboard/nav-config";

export const metadata = {
  title: "Admin · Grants | bkstr",
};

// Phase 4.5 Stream F — admin access_grants ledger + revoke surface.
// ADMIN-only gate inherited from /dashboard/admin/layout.tsx. URL-driven
// filter state (?source=…) matches Stream C's library filter pattern and
// keeps the view link-shareable + refresh-stable.
//
// bkstr redesign PR 5 — migrated off <DashboardShell> to the new
// <DashShell> primitive. Header eyebrow + serif h1 + ink-3 subtitle match
// the pattern established in /dashboard, /dashboard/library, /dashboard/billing.
export const dynamic = "force-dynamic";

// Whitelist of GrantSource values for the ?source filter. Anything off-list
// is treated as no-filter (graceful — don't 400 on a typo in the URL).
const VALID_SOURCES: ReadonlyArray<GrantSource> = [
  GrantSource.SEED,
  GrantSource.SUBSCRIPTION,
  GrantSource.PURCHASE,
  GrantSource.MANUAL,
  GrantSource.PUBLISHER_OWN,
];

function parseSource(raw: string | undefined): GrantSource | undefined {
  if (!raw) return undefined;
  return VALID_SOURCES.find((s) => s === raw);
}

export default async function AdminGrantsPage({
  searchParams,
}: {
  // Next.js 15 — searchParams is a Promise in Server Components.
  searchParams: Promise<{ source?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.email || !session.user.id) redirect("/login");

  const params = await searchParams;
  const source = parseSource(params.source);

  const subscriber = await prisma.subscriber.findFirst({
    where: { user: { email: session.user.email } },
    select: { companyName: true },
  });
  const companyName = subscriber?.companyName ?? "Personal";
  const userEmail = session.user.email;

  const grants = await getAdminGrants({ source });

  return (
    <DashShell
      nav={buildDashNav(session.user.role, "/dashboard/admin/grants")}
      brandSubtitle={companyName.toUpperCase()}
      userBlock={<UserBlock email={userEmail} />}
    >
      <header className="mb-8">
        <Eyebrow>§ ADMN · ACCESS GRANT LEDGER</Eyebrow>
        <h1 className="font-serif font-normal text-[36px] leading-[1.05] tracking-display text-ink mt-3 mb-2">
          Grants
        </h1>
        <p className="text-ink-3 text-sm max-w-[72ch]">
          Every <code className="font-mono text-ink-2">access_grants</code> row
          in the system. Revoke is soft-revoke (
          <code className="font-mono text-ink-2">revoked_at = NOW()</code>) per
          D12.6 — the row stays in the table for audit. Un-revoke is
          operator-only via psql (Q-F5; see{" "}
          <code className="font-mono text-ink-2">docs/operations.md</code>).
        </p>
      </header>

      <AdminGrantsTable
        grants={grants}
        activeSource={source ?? null}
        currentUserId={session.user.id}
        currentUserEmail={session.user.email}
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
