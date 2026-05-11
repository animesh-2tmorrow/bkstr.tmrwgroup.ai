import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { AdminBooksTable } from "@/components/dashboard/admin/admin-books-table";
import { getAdminBooks, getAdminUsers } from "@/lib/dashboard/queries";
import { Role } from "@/generated/prisma/client";

export const metadata = {
  title: "Admin · Books | bkstr",
};

// Phase 4.5 Stream F — admin book ledger + reassign-publisher surface.
// The ADMIN-only gate lives at /dashboard/admin/layout.tsx (D12 — shared
// across Streams E + F); this page inherits it and re-derives the
// shell-decoration session (companyName / userEmail / initial) only.
// `dynamic = "force-dynamic"` matches Stream B/C precedent and is correct
// because the table reflects mutable state (publisher attribution + grant
// counts) that must NOT be cached across operator edits.
export const dynamic = "force-dynamic";

export default async function AdminBooksPage() {
  const session = await auth();
  // Defense-in-depth: the layout already redirected non-ADMIN, but the
  // session is re-read here for the shell decoration. The role re-check is
  // belt-and-suspenders — if the layout is ever bypassed, this still
  // blocks rendering.
  if (!session?.user?.email) redirect("/login");

  const subscriber = await prisma.subscriber.findFirst({
    where: { user: { email: session.user.email } },
    select: { companyName: true },
  });
  const companyName = subscriber?.companyName ?? "Personal";
  const userEmail = session.user.email;
  const initial = (session.user.name?.[0] ?? userEmail[0] ?? "?").toUpperCase();

  // Two queries: the books table itself, and the pool of reassign-target
  // users (PUBLISHER + ADMIN, with subscribers presence). The modal renders
  // server-rendered options from this list — no client-side fetch needed.
  // getAdminUsers (Stream E's shared helper) returns AdminUserRow which
  // already carries hasSubscriber — see Phase 4.5 cross-stream consolidation
  // note in queries.ts. roleFilter accepts Role[] for the PUBLISHER+ADMIN
  // union here.
  const [books, reassignableUsers] = await Promise.all([
    getAdminBooks(),
    getAdminUsers({ roleFilter: [Role.PUBLISHER, Role.ADMIN], sortBy: "email", sortDir: "asc" }),
  ]);

  return (
    <DashboardShell
      active="admin-books"
      companyName={companyName}
      userEmail={userEmail}
      initial={initial}
      role={session.user.role}
    >
      <header className="mb-8">
        <h1 className="text-2xl font-bold">Admin · Books</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage book ownership and access grants. Reassign a book&apos;s
          publisher to another PUBLISHER or ADMIN user — this UI productizes
          the ADMIN-as-seed-owner SQL block in <code>docs/operations.md</code>.
          Only <code>PUBLISHER_OWN</code>-source grants are touched on
          reassign; MANUAL / SEED / PURCHASE / SUBSCRIPTION grants are left
          alone (D12.13).
        </p>
      </header>

      <AdminBooksTable books={books} reassignableUsers={reassignableUsers} />
    </DashboardShell>
  );
}
