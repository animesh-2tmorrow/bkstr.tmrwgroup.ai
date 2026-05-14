"use client";

import Link from "next/link";
import { useState } from "react";
import type { AdminGrantRow } from "@/lib/dashboard/queries";
// Importing from `@/generated/prisma/enums` (not `/client`) keeps client
// bundles free of the Prisma runtime — the enums file is a plain TS const
// object with no node:* dependencies, safe to ship to the browser.
import { GrantSource } from "@/generated/prisma/enums";
import { RevokeGrantModal } from "@/components/dashboard/admin/revoke-grant-modal";

// Phase 4.5 Stream F — ADMIN grants ledger. Filter tabs by source per
// Q-F4 (single-select tab — matches Stream E's tabs pattern). URL-driven
// state means the view is link-shareable; the page re-renders SSR on
// filter change (no client-side filtering).
//
// Active rows (revoked_at IS NULL) get a Revoke button that opens a modal.
// Revoked rows render with strikethrough + the revoked_at timestamp; no
// Revoke button (Q-F5 — re-issue inverse is psql-only).

type FilterKey = "all" | GrantSource;

const FILTERS: ReadonlyArray<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: GrantSource.SEED, label: "SEED" },
  { key: GrantSource.SUBSCRIPTION, label: "SUBSCRIPTION" },
  { key: GrantSource.PURCHASE, label: "PURCHASE" },
  { key: GrantSource.MANUAL, label: "MANUAL" },
  { key: GrantSource.PUBLISHER_OWN, label: "PUBLISHER_OWN" },
];

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  // Stream H.1 — stable ISO format avoids React #418 hydration mismatch
  // caused by toLocaleString() rendering differently on server vs. client.
  return new Date(d).toISOString().slice(0, 16).replace("T", " ");
}

export function AdminGrantsTable({
  grants,
  activeSource,
  currentUserId,
  currentUserEmail,
}: {
  grants: AdminGrantRow[];
  activeSource: GrantSource | null;
  // Stream V (D19.x) — forwarded to RevokeGrantModal for self-protection
  // soft-rail. Required (non-optional) so a missing wire-up at the page
  // surfaces at compile time.
  currentUserId: string;
  currentUserEmail: string;
}) {
  // Modal state — a single grant being revoked at a time.
  const [activeGrant, setActiveGrant] = useState<AdminGrantRow | null>(null);

  const activeKey: FilterKey = activeSource ?? "all";

  return (
    <>
      <nav className="mb-6 inline-flex gap-1 p-1 rounded-lg bg-[#EFE8D8] border border-[#E5DCC8] flex-wrap">
        {FILTERS.map((f) => {
          const isActive = f.key === activeKey;
          const className = isActive
            ? "px-3 py-1.5 rounded-md text-xs font-bold bg-[#FAF6EC] text-black shadow-sm"
            : "px-3 py-1.5 rounded-md text-xs font-bold text-gray-600 hover:text-black";
          // "All" clears the filter; a specific source sets ?source=...
          const href = f.key === "all" ? "/dashboard/admin/grants" : `/dashboard/admin/grants?source=${f.key}`;
          return (
            <Link key={f.key} href={href} className={className}>
              {f.label}
            </Link>
          );
        })}
      </nav>

      {grants.length === 0 ? (
        <div className="bg-[#FAF6EC] border border-[#E5DCC8] rounded-xl shadow-sm p-8 text-center text-gray-500">
          No grants match this filter.
        </div>
      ) : (
        <div className="bg-[#FAF6EC] border border-[#E5DCC8] rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#EFE8D8] border-b border-[#E5DCC8]">
              <tr>
                <th className="px-6 py-4 font-semibold text-gray-600">Subscriber</th>
                <th className="px-6 py-4 font-semibold text-gray-600">Book</th>
                <th className="px-6 py-4 font-semibold text-gray-600">Source</th>
                <th className="px-6 py-4 font-semibold text-gray-600">Granted</th>
                <th className="px-6 py-4 font-semibold text-gray-600">Revoked</th>
                <th className="px-6 py-4 font-semibold text-gray-600">Expires</th>
                <th className="px-6 py-4 font-semibold text-gray-600 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5DCC8]">
              {grants.map((g) => {
                const isRevoked = g.revokedAt !== null;
                // Strikethrough revoked rows so the eye picks up active-vs-revoked
                // at a glance. The text color stays readable so the operator can
                // still read the row's content.
                const rowClass = isRevoked
                  ? "hover:bg-[#F5F0E6] transition-colors text-gray-500 line-through"
                  : "hover:bg-[#F5F0E6] transition-colors";
                return (
                  <tr key={g.id} className={rowClass}>
                    <td className="px-6 py-4">{g.subscriberEmail}</td>
                    <td className="px-6 py-4">
                      {/* Stream L: a grant points at either a book or a skill
                          (XOR-checked at the DB layer). Render whichever is
                          populated; the "—" fallback is defensive. */}
                      <div className="font-medium flex items-center gap-2">
                        {g.bookTitle ?? g.skillName ?? "—"}
                        <span className="text-[10px] uppercase tracking-wide text-gray-500 bg-[#EAE2D0] px-1.5 py-0.5 rounded">
                          {g.bookId ? "Book" : g.skillId ? "Skill" : "—"}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 font-mono mt-1">
                        {g.bookSlug ?? g.skillSlug ?? "—"}
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs">{g.source}</td>
                    <td className="px-6 py-4 text-xs">{fmtDate(g.grantedAt)}</td>
                    <td className="px-6 py-4 text-xs">{fmtDate(g.revokedAt)}</td>
                    <td className="px-6 py-4 text-xs">{fmtDate(g.expiresAt)}</td>
                    <td className="px-6 py-4 text-right">
                      {isRevoked ? (
                        <span className="text-xs text-gray-400 italic">revoked</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setActiveGrant(g)}
                          className="bg-black text-[#FAF6EC] px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-black shadow-sm"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {activeGrant && (
        <RevokeGrantModal
          grant={activeGrant}
          currentUserId={currentUserId}
          currentUserEmail={currentUserEmail}
          onClose={() => setActiveGrant(null)}
        />
      )}
    </>
  );
}
