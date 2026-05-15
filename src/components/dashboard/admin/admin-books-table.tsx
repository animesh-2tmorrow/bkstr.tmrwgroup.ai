"use client";

import { useState } from "react";
import type { AdminBookRow, AdminUserRow } from "@/lib/dashboard/queries";
import { ReassignPublisherModal } from "@/components/dashboard/admin/reassign-publisher-modal";
import { ArchiveBookButton } from "@/components/dashboard/admin/archive-book-modal";
import { formatUsdCents } from "@/lib/format/currency";

// Phase 4.5 Stream F — ADMIN books ledger. One row per book in the system.
// The Reassign button opens <ReassignPublisherModal>; the modal POSTs to
// /api/admin/books/[id]/reassign and on success the modal calls
// router.refresh() to re-render this page server-side (the underlying
// table is re-driven by getAdminBooks() so the new publisher / refreshed
// grant count appears).
//
// Publisher rendering matches the brief: prefer publisherUser.name; the
// email is shown as a subtitle so the operator can disambiguate when
// multiple users share a name. Falls back to publisher.name (the tenant
// row) when publisher_user_id is NULL (the "unattributed" state) — though
// today every seed book is attributed to ADMIN via the ADMIN-as-seed-owner
// runbook, so unattributed rows are rare.
//
// bkstr redesign PR 5 — restyled with design tokens.

export function AdminBooksTable({
  books,
  reassignableUsers,
}: {
  books: AdminBookRow[];
  reassignableUsers: AdminUserRow[];
}) {
  // Currently-open modal: the book being reassigned, or null when closed.
  // Single-modal state (one at a time) matches Q-F2 — bulk reassign is OOS.
  const [activeBook, setActiveBook] = useState<AdminBookRow | null>(null);

  if (books.length === 0) {
    return (
      <div className="bg-paper border border-rule p-8 text-center text-ink-3 text-sm">
        No books in the system yet.
      </div>
    );
  }

  return (
    <>
      <div className="bg-paper border border-rule overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink">
              <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Title</th>
              <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Publisher</th>
              <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Status</th>
              <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Price</th>
              <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Active grants</th>
              <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {books.map((b) => {
              // Publisher display: prefer per-user name → tenant name fallback.
              // The user's email appears as a subtitle so operators can
              // distinguish e.g. "Animesh @ aimplemented" from "Animesh @ 2tmorrow"
              // when both names render the same. If publisher_user_id is NULL
              // we render "— (unattributed)" with the tenant Publisher.name
              // as the subtitle for context.
              const userNameDisplay =
                b.publisherUserName && b.publisherUserName.trim().length > 0
                  ? b.publisherUserName
                  : null;
              const primaryLabel = userNameDisplay
                ? userNameDisplay
                : b.publisherUserId
                  ? b.publisherUserEmail ?? "— (no name)"
                  : "— (unattributed)";
              const subtitle = b.publisherUserId
                ? b.publisherUserEmail ?? ""
                : `tenant: ${b.publisherTenantName}`;

              return (
                <tr key={b.id} className="border-b border-rule hover:bg-paper-2 transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-serif text-ink">{b.title}</div>
                    <div className="font-mono text-[11px] text-ink-3 mt-1">
                      {b.slug} <span className="text-ink-4">·</span> {b.domain}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-ink-2 text-sm">{primaryLabel}</div>
                    {subtitle && (
                      <div className="font-mono text-[11px] text-ink-3 mt-1">{subtitle}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 font-mono text-[11px] uppercase tracking-eyebrow text-ink-2">{b.status}</td>
                  <td className="px-6 py-4 font-mono text-[13px] text-ink num tabular-nums">
                    {b.unitAmountCents !== null ? (
                      formatUsdCents(b.unitAmountCents)
                    ) : (
                      <span className="text-ink-4 italic font-serif">Not for sale</span>
                    )}
                  </td>
                  <td className="px-6 py-4 font-mono text-[13px] text-ink num tabular-nums">
                    {b.activeGrantCount.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <ArchiveBookButton
                        book={{ id: b.id, slug: b.slug, title: b.title, status: b.status }}
                        adminMode
                      />
                      <button
                        type="button"
                        onClick={() => setActiveBook(b)}
                        className="bg-ink text-paper px-3 py-1.5 font-mono text-[11px] tracking-eyebrow uppercase hover:bg-ink-2 transition-colors"
                      >
                        Reassign
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {activeBook && (
        <ReassignPublisherModal
          book={activeBook}
          reassignableUsers={reassignableUsers}
          onClose={() => setActiveBook(null)}
        />
      )}
    </>
  );
}
