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
// Q-F4 (single-select tab). URL-driven state means the view is
// link-shareable; the page re-renders SSR on filter change.
//
// Active rows (revoked_at IS NULL) get a Revoke button that opens a modal.
// Revoked rows render with strikethrough + the revoked_at timestamp; no
// Revoke button (Q-F5 — re-issue inverse is psql-only).
//
// bkstr redesign PR 5 — restyled with design tokens. Square corners
// (no rounded-xl/lg), no shadows, hairline rules on borders, ink-on-paper
// pills. Modal interior untouched (out of scope; revoke-grant-modal.tsx
// already on tokens via Stream V).

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
      <nav className="mb-6 inline-flex gap-px bg-rule border border-rule flex-wrap">
        {FILTERS.map((f) => {
          const isActive = f.key === activeKey;
          const className = isActive
            ? "px-3 py-1.5 font-mono text-[11px] tracking-eyebrow uppercase bg-ink text-paper"
            : "px-3 py-1.5 font-mono text-[11px] tracking-eyebrow uppercase bg-paper text-ink-3 hover:text-ink hover:bg-paper-2";
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
        <div className="bg-paper border border-rule p-8 text-center text-ink-3 text-sm">
          No grants match this filter.
        </div>
      ) : (
        <div className="bg-paper border border-rule overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink">
                <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Subscriber</th>
                <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Book / Skill</th>
                <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Source</th>
                <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Granted</th>
                <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Revoked</th>
                <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Expires</th>
                <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => {
                const isRevoked = g.revokedAt !== null;
                // Strikethrough revoked rows so the eye picks up active-vs-revoked
                // at a glance. The text color stays readable so the operator can
                // still read the row's content.
                const rowClass = isRevoked
                  ? "border-b border-rule hover:bg-paper-2 transition-colors text-ink-3 line-through"
                  : "border-b border-rule hover:bg-paper-2 transition-colors";
                return (
                  <tr key={g.id} className={rowClass}>
                    <td className="px-6 py-4 text-ink-2">{g.subscriberEmail}</td>
                    <td className="px-6 py-4">
                      {/* Stream L: a grant points at either a book or a skill
                          (XOR-checked at the DB layer). Render whichever is
                          populated; the "—" fallback is defensive. */}
                      <div className="font-serif text-ink flex items-center gap-2">
                        {g.bookTitle ?? g.skillName ?? "—"}
                        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-3 bg-paper-2 px-1.5 py-0.5 border border-rule">
                          {g.bookId ? "Book" : g.skillId ? "Skill" : "—"}
                        </span>
                      </div>
                      <div className="font-mono text-[11px] text-ink-3 mt-1">
                        {g.bookSlug ?? g.skillSlug ?? "—"}
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono text-[11px] text-ink-2 uppercase">{g.source}</td>
                    <td className="px-6 py-4 font-mono text-[11px] text-ink-3">{fmtDate(g.grantedAt)}</td>
                    <td className="px-6 py-4 font-mono text-[11px] text-ink-3">{fmtDate(g.revokedAt)}</td>
                    <td className="px-6 py-4 font-mono text-[11px] text-ink-3">{fmtDate(g.expiresAt)}</td>
                    <td className="px-6 py-4 text-right">
                      {isRevoked ? (
                        <span className="font-mono text-[11px] text-ink-4 italic">revoked</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setActiveGrant(g)}
                          className="bg-ink text-paper px-3 py-1.5 text-[11px] font-mono tracking-eyebrow uppercase hover:bg-ink-2 transition-colors"
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
