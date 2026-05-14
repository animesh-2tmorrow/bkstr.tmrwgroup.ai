import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { AdminGrantsTable } from "@/components/dashboard/admin/admin-grants-table";
import { getAdminGrants } from "@/lib/dashboard/queries";
import { GrantSource } from "@/generated/prisma/client";

export const metadata = {
  title: "Admin · Grants | bkstr",
};

// Phase 4.5 Stream F — admin access_grants ledger + revoke surface.
// ADMIN-only gate inherited from /dashboard/admin/layout.tsx. URL-driven
// filter state (?source=…) matches Stream C's library filter pattern and
// keeps the view link-shareable + refresh-stable.
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
  const initial = (session.user.name?.[0] ?? userEmail[0] ?? "?").toUpperCase();

  const grants = await getAdminGrants({ source });

  return (
    <DashboardShell
      active="admin-grants"
      companyName={companyName}
      userEmail={userEmail}
      initial={initial}
      role={session.user.role}
    >
      <header className="mb-8">
        <h1 className="text-2xl font-bold">Admin · Grants</h1>
        <p className="text-sm text-gray-500 mt-1">
          Every <code>access_grants</code> row in the system. Revoke is
          soft-revoke (<code>revoked_at = NOW()</code>) per D12.6 — the row
          stays in the table for audit. Un-revoke is operator-only via psql
          (Q-F5; see <code>docs/operations.md</code>).
        </p>
      </header>

      <AdminGrantsTable
        grants={grants}
        activeSource={source ?? null}
        currentUserId={session.user.id}
        currentUserEmail={session.user.email}
      />
    </DashboardShell>
  );
}
