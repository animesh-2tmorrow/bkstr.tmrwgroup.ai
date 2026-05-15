import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashShell, Eyebrow } from "@/components/design";
import { AdminBooksTable } from "@/components/dashboard/admin/admin-books-table";
import { getAdminBooks, getAdminUsers } from "@/lib/dashboard/queries";
import { Role } from "@/generated/prisma/client";
import { buildDashNav } from "@/lib/dashboard/nav-config";

export const metadata = {
  title: "Admin · Books | bkstr",
};

// Phase 4.5 Stream F — admin book ledger + reassign-publisher surface.
// The ADMIN-only gate lives at /dashboard/admin/layout.tsx (D12 — shared
// across Streams E + F); this page inherits it and re-derives the
// shell-decoration session (companyName / userEmail) only.
// `dynamic = "force-dynamic"` matches Stream B/C precedent and is correct
// because the table reflects mutable state (publisher attribution + grant
// counts) that must NOT be cached across operator edits.
//
// bkstr redesign PR 5 — migrated to <DashShell> + design-token header.
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
    <DashShell
      nav={buildDashNav(session.user.role, "/dashboard/admin/books")}
      brandSubtitle={companyName.toUpperCase()}
      userBlock={<UserBlock email={userEmail} />}
    >
      <header className="mb-8">
        <Eyebrow>§ ADMN · CATALOG OWNERSHIP LEDGER</Eyebrow>
        <h1 className="font-serif font-normal text-[36px] leading-[1.05] tracking-display text-ink mt-3 mb-2">
          Books
        </h1>
        <p className="text-ink-3 text-sm max-w-[72ch]">
          Manage book ownership and access grants. Reassign a book&apos;s
          publisher to another PUBLISHER or ADMIN user — this UI productizes
          the ADMIN-as-seed-owner SQL block in{" "}
          <code className="font-mono text-ink-2">docs/operations.md</code>.
          Only <code className="font-mono text-ink-2">PUBLISHER_OWN</code>-source
          grants are touched on reassign; MANUAL / SEED / PURCHASE /
          SUBSCRIPTION grants are left alone (D12.13).
        </p>
      </header>

      <AdminBooksTable books={books} reassignableUsers={reassignableUsers} />
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
