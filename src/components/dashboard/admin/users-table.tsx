import Link from "next/link";
import type { AdminUserRow, AdminUsersSortBy, AdminUsersSortDir } from "@/lib/dashboard/queries";
import { Role } from "@/generated/prisma/client";
import { RoleMutationButton } from "@/components/dashboard/admin/role-mutation-modal";

// Phase 4.5 Stream E (Q-E4 / Q-E8) — server-renderable admin users table.
//
// Filter state lives in URL search params (?role=…&sort=…&dir=…) so the view
// is link-shareable + refresh-stable, mirroring Stream C's Library-table
// pattern at src/components/dashboard/library-table.tsx:20-58. The page
// component (app/dashboard/admin/users/page.tsx) reads the params and passes
// the parsed values down; this component only renders.
//
// Columns (Q-E8): Email / Company / Role / Created / Last signin / Actions.
// Sort: server-side via Link rewrites on column headers (sortBy + sortDir);
// click-to-sort on email / created_at / last_signin_at. Defer client-side
// sort to a follow-up if it ever matters.
//
// Actions cell: a RoleMutationButton client island per row. The button opens
// the asymmetric-friction modal (D12.10) which posts to
// /api/admin/users/[id]/role and refreshes on success.

export type UsersTableFilter = "all" | "SUBSCRIBER" | "PUBLISHER" | "ADMIN";

const FILTERS: ReadonlyArray<{ key: UsersTableFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "SUBSCRIBER", label: "SUBSCRIBER" },
  { key: "PUBLISHER", label: "PUBLISHER" },
  { key: "ADMIN", label: "ADMIN" },
];

// Build a /dashboard/admin/users?role=…&sort=…&dir=… href preserving the
// other querystring values when the operator clicks a column header or a
// filter tab.
function buildHref(opts: {
  filter: UsersTableFilter;
  sortBy: AdminUsersSortBy;
  sortDir: AdminUsersSortDir;
  override?: Partial<{
    filter: UsersTableFilter;
    sortBy: AdminUsersSortBy;
    sortDir: AdminUsersSortDir;
  }>;
}): string {
  const filter = opts.override?.filter ?? opts.filter;
  const sortBy = opts.override?.sortBy ?? opts.sortBy;
  const sortDir = opts.override?.sortDir ?? opts.sortDir;
  const qs = new URLSearchParams();
  if (filter !== "all") qs.set("role", filter);
  if (sortBy !== "last_signin_at") qs.set("sort", sortBy);
  if (sortDir !== "desc") qs.set("dir", sortDir);
  const s = qs.toString();
  return s ? `/dashboard/admin/users?${s}` : "/dashboard/admin/users";
}

// When the operator clicks a column header, the new sortDir is the opposite
// of the current direction IF the column is already the active sort. If the
// column is becoming the new active sort, default to a sensible direction:
// "desc" for created_at + last_signin_at (most-recent first); "asc" for
// email (alphabetical first).
function nextSortDirFor(
  column: AdminUsersSortBy,
  currentSortBy: AdminUsersSortBy,
  currentSortDir: AdminUsersSortDir,
): AdminUsersSortDir {
  if (column === currentSortBy) return currentSortDir === "asc" ? "desc" : "asc";
  return column === "email" ? "asc" : "desc";
}

function sortIndicator(
  column: AdminUsersSortBy,
  currentSortBy: AdminUsersSortBy,
  currentSortDir: AdminUsersSortDir,
): string {
  if (column !== currentSortBy) return "";
  return currentSortDir === "asc" ? " ↑" : " ↓";
}

// "Apr 12" / "Apr 12, 2025" — short relative-friendly format. The Last-signin
// column intentionally uses a coarser format (no time-of-day) — the operator
// pivots on "has this user signed in recently" and the day-grain is enough.
function formatShortDate(d: Date | null): string {
  if (d === null) return "—"; // em-dash for NULL last-signin
  const now = new Date();
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
  if (sameYear) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function UsersTable({
  users,
  filter,
  sortBy,
  sortDir,
  currentUserId,
}: {
  users: AdminUserRow[];
  filter: UsersTableFilter;
  sortBy: AdminUsersSortBy;
  sortDir: AdminUsersSortDir;
  // The logged-in ADMIN's id — used to mark "you" in the table and to enable
  // the per-row self-protection hint in the modal (D12.9 Gate 1). The server
  // still enforces the gate; this is UI affordance only.
  currentUserId: string;
}) {
  return (
    <div>
      <nav className="mb-6 inline-flex gap-1 p-1 rounded-lg bg-[#EFE8D8] border border-[#E5DCC8]">
        {FILTERS.map((f) => {
          const isActive = f.key === filter;
          const className = isActive
            ? "px-4 py-1.5 rounded-md text-xs font-bold bg-[#FAF6EC] text-black shadow-sm"
            : "px-4 py-1.5 rounded-md text-xs font-bold text-gray-600 hover:text-black";
          return (
            <Link
              key={f.key}
              href={buildHref({ filter, sortBy, sortDir, override: { filter: f.key } })}
              className={className}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      <div className="bg-[#FAF6EC] border border-[#E5DCC8] rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#EFE8D8] border-b border-[#E5DCC8]">
            <tr>
              <th className="px-6 py-4 font-semibold text-gray-600">
                <Link
                  href={buildHref({
                    filter,
                    sortBy,
                    sortDir,
                    override: { sortBy: "email", sortDir: nextSortDirFor("email", sortBy, sortDir) },
                  })}
                  className="hover:text-black"
                >
                  Email{sortIndicator("email", sortBy, sortDir)}
                </Link>
              </th>
              <th className="px-6 py-4 font-semibold text-gray-600">Company</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Role</th>
              <th className="px-6 py-4 font-semibold text-gray-600">
                <Link
                  href={buildHref({
                    filter,
                    sortBy,
                    sortDir,
                    override: {
                      sortBy: "created_at",
                      sortDir: nextSortDirFor("created_at", sortBy, sortDir),
                    },
                  })}
                  className="hover:text-black"
                >
                  Created{sortIndicator("created_at", sortBy, sortDir)}
                </Link>
              </th>
              <th className="px-6 py-4 font-semibold text-gray-600">
                <Link
                  href={buildHref({
                    filter,
                    sortBy,
                    sortDir,
                    override: {
                      sortBy: "last_signin_at",
                      sortDir: nextSortDirFor("last_signin_at", sortBy, sortDir),
                    },
                  })}
                  className="hover:text-black"
                >
                  Last signin{sortIndicator("last_signin_at", sortBy, sortDir)}
                </Link>
              </th>
              <th className="px-6 py-4 font-semibold text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5DCC8]">
            {users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                  No users match this filter.
                </td>
              </tr>
            ) : (
              users.map((u) => {
                const isSelf = u.id === currentUserId;
                return (
                  <tr key={u.id}>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{u.email}</div>
                      {u.name && (
                        <div className="text-xs text-gray-500 mt-1">
                          {u.name}
                          {isSelf && <span className="ml-2 text-gray-400">(you)</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-700">{u.companyName ?? "—"}</td>
                    <td className="px-6 py-4">
                      <RoleChip role={u.role} />
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-600">
                      {formatShortDate(u.createdAt)}
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-600">
                      {formatShortDate(u.lastSigninAt)}
                    </td>
                    <td className="px-6 py-4">
                      <RoleMutationButton
                        userId={u.id}
                        email={u.email}
                        currentRole={u.role}
                        isSelf={isSelf}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RoleChip({ role }: { role: Role }) {
  // Color-code roles so ADMIN rows stand out visually — operator's eye should
  // land on the privileged rows first. Tailwind utility classes only (no
  // global CSS additions); palette matches the existing dashboard surface.
  const className =
    role === Role.ADMIN
      ? "inline-block px-2 py-1 rounded-md text-xs font-bold bg-black text-[#FAF6EC]"
      : role === Role.PUBLISHER
        ? "inline-block px-2 py-1 rounded-md text-xs font-bold bg-[#EAE2D0] text-gray-900"
        : "inline-block px-2 py-1 rounded-md text-xs font-medium bg-white border border-[#E5DCC8] text-gray-700";
  return <span className={className}>{role}</span>;
}
