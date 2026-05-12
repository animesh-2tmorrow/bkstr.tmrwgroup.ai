import { prisma } from "@/lib/db";
import { CancelInvitationButton } from "./cancel-invitation-button";

// Phase 5 Stream E (D15.1 / D15.2) — pending-invitations table.
//
// Server component. Lists open + recently-accepted invitations. Columns:
// Email / Role / Invited by / Invited at / Status / Accepted at /
// Mismatch / Actions. Actions cell on unaccepted rows renders the
// CancelInvitationButton client island; accepted rows show a "—".

function formatShortDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function StatusPill({
  status,
  accepted,
  expired,
}: {
  status: string;
  accepted: boolean;
  expired: boolean;
}) {
  // Effective status: accepted wins over everything; expired then beats
  // pending/sent/failed; cancelled is its own thing.
  let label = status;
  let cls = "inline-block px-2 py-1 rounded-md text-xs font-medium bg-white border border-[#E5DCC8] text-gray-700";
  if (accepted) {
    label = "accepted";
    cls = "inline-block px-2 py-1 rounded-md text-xs font-bold bg-green-100 text-green-800";
  } else if (status === "cancelled") {
    label = "cancelled";
    cls = "inline-block px-2 py-1 rounded-md text-xs font-medium bg-gray-200 text-gray-700";
  } else if (expired) {
    label = "expired";
    cls = "inline-block px-2 py-1 rounded-md text-xs font-medium bg-amber-100 text-amber-800";
  } else if (status === "sent") {
    cls = "inline-block px-2 py-1 rounded-md text-xs font-medium bg-blue-100 text-blue-800";
  } else if (status === "failed") {
    cls = "inline-block px-2 py-1 rounded-md text-xs font-bold bg-red-100 text-red-800";
  } else if (status === "pending") {
    cls = "inline-block px-2 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-700";
  }
  return <span className={cls}>{label}</span>;
}

export async function PendingInvitationsTable() {
  const rows = await prisma.userInvitation.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      email: true,
      role: true,
      invitedBy: { select: { email: true, name: true } },
      expiresAt: true,
      acceptedAt: true,
      emailSendStatus: true,
      emailSendError: true,
      emailMismatchNote: true,
      createdAt: true,
    },
  });

  if (rows.length === 0) {
    return (
      <section className="mt-12">
        <header className="mb-4">
          <h2 className="text-xl font-bold">Invitations</h2>
          <p className="text-sm text-gray-500 mt-1">No invitations issued yet.</p>
        </header>
      </section>
    );
  }

  const now = new Date();

  return (
    <section className="mt-12">
      <header className="mb-4">
        <h2 className="text-xl font-bold">Invitations</h2>
        <p className="text-sm text-gray-500 mt-1">
          Pending + recently-accepted invitations (50 most recent). The
          15-min expiry runs from the createdAt timestamp.
        </p>
      </header>
      <div className="bg-[#FAF6EC] border border-[#E5DCC8] rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#EFE8D8] border-b border-[#E5DCC8]">
            <tr>
              <th className="px-6 py-4 font-semibold text-gray-600">Email</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Role</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Invited by</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Invited at</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Status</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Accepted at</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Note</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5DCC8]">
            {rows.map((r) => {
              const accepted = r.acceptedAt !== null;
              const expired = !accepted && r.expiresAt < now;
              const cancellable = !accepted && r.emailSendStatus !== "cancelled";
              return (
                <tr key={r.id}>
                  <td className="px-6 py-4 font-medium text-gray-900">{r.email}</td>
                  <td className="px-6 py-4 font-mono text-xs uppercase">{r.role}</td>
                  <td className="px-6 py-4 text-xs text-gray-600">
                    {r.invitedBy.name ?? r.invitedBy.email}
                  </td>
                  <td className="px-6 py-4 text-xs text-gray-600">
                    {formatShortDate(r.createdAt)}
                  </td>
                  <td className="px-6 py-4">
                    <StatusPill
                      status={r.emailSendStatus}
                      accepted={accepted}
                      expired={expired}
                    />
                    {r.emailSendError && (
                      <div className="text-xs text-red-700 mt-1 font-mono">
                        {r.emailSendError.slice(0, 80)}
                        {r.emailSendError.length > 80 ? "…" : ""}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-xs text-gray-600">
                    {formatShortDate(r.acceptedAt)}
                  </td>
                  <td className="px-6 py-4 text-xs text-gray-600">
                    {r.emailMismatchNote ? (
                      <span className="text-amber-800">{r.emailMismatchNote}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {cancellable ? (
                      <CancelInvitationButton invitationId={r.id} email={r.email} />
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
