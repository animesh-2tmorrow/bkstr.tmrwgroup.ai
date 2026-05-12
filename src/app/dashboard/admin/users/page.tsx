import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import {
  UsersTable,
  type UsersTableFilter,
} from "@/components/dashboard/admin/users-table";
import { InviteUserButton } from "@/components/dashboard/admin/invite-user-modal";
import { PendingInvitationsTable } from "@/components/dashboard/admin/pending-invitations-table";
import {
  getAdminUsers,
  type AdminUsersSortBy,
  type AdminUsersSortDir,
} from "@/lib/dashboard/queries";
import { Role } from "@/generated/prisma/client";

// Phase 4.5 Stream E — ADMIN users-list surface.
//
// The ADMIN-only guard runs in the shared layout at
// app/dashboard/admin/layout.tsx — a non-ADMIN request is redirected before
// this leaf renders. Defense-in-depth: this page ALSO calls auth() (to fetch
// the session.user.id for the table's "(you)" badge + the per-row self-
// protection gate hint at D12.9 Gate 1) but does not re-check the role; if
// for some reason the layout-level redirect failed, the API handler at
// /api/admin/users/[id]/role still re-checks role on every mutation, which
// is the load-bearing authz floor.
//
// Filter + sort state lives in URL search params (?role=…&sort=…&dir=…) so
// the view is link-shareable + refresh-stable, mirroring Library's pattern at
// app/dashboard/library/page.tsx:21-25.

export const metadata = {
  title: "Admin: Users | bkstr",
};

export const dynamic = "force-dynamic";

const VALID_ROLE_FILTERS: ReadonlySet<UsersTableFilter> = new Set([
  "all",
  "SUBSCRIBER",
  "PUBLISHER",
  "ADMIN",
]);

function parseRoleFilter(raw: string | string[] | undefined): UsersTableFilter {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v && VALID_ROLE_FILTERS.has(v as UsersTableFilter)) {
    return v as UsersTableFilter;
  }
  return "all";
}

function parseSortBy(raw: string | string[] | undefined): AdminUsersSortBy {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "email" || v === "created_at" || v === "last_signin_at") return v;
  return "last_signin_at";
}

function parseSortDir(raw: string | string[] | undefined): AdminUsersSortDir {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "asc" || v === "desc") return v;
  return "desc";
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    role?: string | string[];
    sort?: string | string[];
    dir?: string | string[];
  }>;
}) {
  // The layout already enforces ADMIN; this auth() call is for the session
  // identity that the table needs (currentUserId — for the "(you)" badge +
  // the modal's self-protection hint).
  const session = await auth();
  if (!session?.user?.email || !session.user.id) redirect("/login");

  const params = await searchParams;
  const filter = parseRoleFilter(params.role);
  const sortBy = parseSortBy(params.sort);
  const sortDir = parseSortDir(params.dir);

  // The roleFilter passed to getAdminUsers is `undefined` for "all", a Role
  // enum value otherwise — the query short-circuits the WHERE clause when
  // undefined (returns every row).
  const roleFilter = filter === "all" ? undefined : (filter as Role);

  const [subscriber, users] = await Promise.all([
    prisma.subscriber.findFirst({
      where: { user: { email: session.user.email } },
      select: { companyName: true },
    }),
    getAdminUsers({ roleFilter, sortBy, sortDir }),
  ]);

  const companyName = subscriber?.companyName ?? "Personal";
  const userEmail = session.user.email;
  const initial = (session.user.name?.[0] ?? userEmail[0] ?? "?").toUpperCase();

  return (
    <DashboardShell
      active="admin-users"
      companyName={companyName}
      userEmail={userEmail}
      initial={initial}
      role={session.user.role}
    >
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Admin: Users</h1>
          <p className="text-sm text-gray-500 mt-1">
            Promote or demote users between SUBSCRIBER / PUBLISHER / ADMIN roles.
            Every mutation writes a durable audit row to{" "}
            <span className="font-mono">admin_actions</span> (Phase 4.5 Stream G).
            See the Stream E runbook in{" "}
            <span className="font-mono">docs/operations.md</span> for the
            env-file-vs-UI consistency story.
          </p>
        </div>
        <InviteUserButton />
      </header>

      <UsersTable
        users={users}
        filter={filter}
        sortBy={sortBy}
        sortDir={sortDir}
        currentUserId={session.user.id}
      />

      <PendingInvitationsTable />
    </DashboardShell>
  );
}
