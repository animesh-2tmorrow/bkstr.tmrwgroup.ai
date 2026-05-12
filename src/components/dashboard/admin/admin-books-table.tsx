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
      <div className="bg-[#FAF6EC] border border-[#E5DCC8] rounded-xl shadow-sm p-8 text-center text-gray-500">
        No books in the system yet.
      </div>
    );
  }

  return (
    <>
      <div className="bg-[#FAF6EC] border border-[#E5DCC8] rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#EFE8D8] border-b border-[#E5DCC8]">
            <tr>
              <th className="px-6 py-4 font-semibold text-gray-600">Title</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Publisher</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Status</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Price</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Active grants</th>
              <th className="px-6 py-4 font-semibold text-gray-600 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5DCC8]">
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
                <tr key={b.id} className="hover:bg-[#F5F0E6] transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-bold text-gray-900">{b.title}</div>
                    <div className="text-xs text-gray-500 font-mono mt-1">
                      {b.slug} <span className="text-gray-400">·</span> {b.domain}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-gray-900">{primaryLabel}</div>
                    {subtitle && (
                      <div className="text-xs text-gray-500 font-mono mt-1">{subtitle}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 font-mono text-xs uppercase">{b.status}</td>
                  <td className="px-6 py-4 font-medium">
                    {b.unitAmountCents !== null ? (
                      formatUsdCents(b.unitAmountCents)
                    ) : (
                      <span className="text-gray-400 italic">Not for sale</span>
                    )}
                  </td>
                  <td className="px-6 py-4 font-medium">
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
                        className="bg-black text-[#FAF6EC] px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-black shadow-sm"
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
