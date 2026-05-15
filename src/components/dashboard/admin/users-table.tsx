import Link from "next/link";
import type { AdminUserRow, AdminUsersSortBy, AdminUsersSortDir } from "@/lib/dashboard/queries";
import { Role } from "@/generated/prisma/client";
import { RoleMutationButton } from "@/components/dashboard/admin/role-mutation-modal";

// Phase 4.5 Stream E (Q-E4 / Q-E8) — server-renderable admin users table.
//
// Filter state lives in URL search params (?role=…&sort=…&dir=…) so the view
// is link-shareable + refresh-stable, mirroring Stream C's Library-table
// pattern at src/components/dashboard/library-table.tsx.
//
// Columns: Email / Company / Role / Created / Last signin / Actions.
// Sort: server-side via Link rewrites on column headers (sortBy + sortDir);
// click-to-sort on email / created_at / last_signin_at.
//
// Actions cell: a RoleMutationButton client island per row. The button opens
// the asymmetric-friction modal (D12.10) which posts to
// /api/admin/users/[id]/role and refreshes on success.
//
// bkstr redesign PR 5 — restyled with design tokens.

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
      <nav className="mb-6 inline-flex gap-px bg-rule border border-rule">
        {FILTERS.map((f) => {
          const isActive = f.key === filter;
          const className = isActive
            ? "px-4 py-1.5 font-mono text-[11px] tracking-eyebrow uppercase bg-ink text-paper"
            : "px-4 py-1.5 font-mono text-[11px] tracking-eyebrow uppercase bg-paper text-ink-3 hover:text-ink hover:bg-paper-2";
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

      <div className="bg-paper border border-rule overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink">
              <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">
                <Link
                  href={buildHref({
                    filter,
                    sortBy,
                    sortDir,
                    override: { sortBy: "email", sortDir: nextSortDirFor("email", sortBy, sortDir) },
                  })}
                  className="hover:text-ink"
                >
                  Email{sortIndicator("email", sortBy, sortDir)}
                </Link>
              </th>
              <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Company</th>
              <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Role</th>
              <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">
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
                  className="hover:text-ink"
                >
                  Created{sortIndicator("created_at", sortBy, sortDir)}
                </Link>
              </th>
              <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">
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
                  className="hover:text-ink"
                >
                  Last signin{sortIndicator("last_signin_at", sortBy, sortDir)}
                </Link>
              </th>
              <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-ink-3 text-sm">
                  No users match this filter.
                </td>
              </tr>
            ) : (
              users.map((u) => {
                const isSelf = u.id === currentUserId;
                return (
                  <tr key={u.id} className="border-b border-rule hover:bg-paper-2 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-serif text-ink">{u.email}</div>
                      {u.name && (
                        <div className="font-mono text-[11px] text-ink-3 mt-1">
                          {u.name}
                          {isSelf && <span className="ml-2 text-ink-4">(you)</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-ink-2 text-sm">{u.companyName ?? "—"}</td>
                    <td className="px-6 py-4">
                      <RoleChip role={u.role} />
                    </td>
                    <td className="px-6 py-4 font-mono text-[11px] text-ink-3">
                      {formatShortDate(u.createdAt)}
                    </td>
                    <td className="px-6 py-4 font-mono text-[11px] text-ink-3">
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
  // land on the privileged rows first. Design-token palette (ink-on-paper)
  // with no rounded corners; ADMIN gets the inverted treatment.
  const className =
    role === Role.ADMIN
      ? "inline-block px-2 py-1 font-mono text-[11px] tracking-eyebrow uppercase bg-ink text-paper"
      : role === Role.PUBLISHER
        ? "inline-block px-2 py-1 font-mono text-[11px] tracking-eyebrow uppercase bg-paper-2 border border-rule text-ink"
        : "inline-block px-2 py-1 font-mono text-[11px] tracking-eyebrow uppercase bg-paper border border-rule text-ink-2";
  return <span className={className}>{role}</span>;
}
