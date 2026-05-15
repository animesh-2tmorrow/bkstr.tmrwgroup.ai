import { prisma } from "@/lib/db";
import { CancelInvitationButton } from "./cancel-invitation-button";
import { Eyebrow } from "@/components/design";

// Phase 5 Stream E (D15.1 / D15.2) — pending-invitations table.
//
// Server component. Lists open + recently-accepted invitations. Columns:
// Email / Role / Invited by / Invited at / Status / Accepted at /
// Mismatch / Actions. Actions cell on unaccepted rows renders the
// CancelInvitationButton client island; accepted rows show a "—".
//
// bkstr redesign PR 5 — restyled with design tokens.

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
  // pending/sent/failed; cancelled is its own thing. Token palette uses the
  // design-system status colors (status-ok / status-warn / status-err /
  // status-info) with a low-opacity background tint.
  let label = status;
  const base = "inline-block px-2 py-1 font-mono text-[11px] tracking-eyebrow uppercase";
  let cls = `${base} bg-paper border border-rule text-ink-2`;
  if (accepted) {
    label = "accepted";
    cls = `${base} bg-status-ok/10 text-status-ok border border-status-ok/30`;
  } else if (status === "cancelled") {
    label = "cancelled";
    cls = `${base} bg-paper-2 text-ink-3 border border-rule`;
  } else if (expired) {
    label = "expired";
    cls = `${base} bg-status-warn/10 text-status-warn border border-status-warn/30`;
  } else if (status === "sent") {
    cls = `${base} bg-status-info/10 text-status-info border border-status-info/30`;
  } else if (status === "failed") {
    cls = `${base} bg-status-err/10 text-status-err border border-status-err/30`;
  } else if (status === "pending") {
    cls = `${base} bg-paper-2 text-ink-3 border border-rule`;
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
          <Eyebrow>§ INVITATIONS</Eyebrow>
          <h2 className="font-serif text-[22px] tracking-display text-ink mt-2 mb-1">
            Invitations
          </h2>
          <p className="text-ink-3 text-sm">No invitations issued yet.</p>
        </header>
      </section>
    );
  }

  const now = new Date();

  return (
    <section className="mt-12">
      <header className="mb-4">
        <Eyebrow>§ INVITATIONS</Eyebrow>
        <h2 className="font-serif text-[22px] tracking-display text-ink mt-2 mb-1">
          Invitations
        </h2>
        <p className="text-ink-3 text-sm">
          Pending + recently-accepted invitations (50 most recent). The 15-min
          expiry runs from the createdAt timestamp.
        </p>
      </header>
      <div className="bg-paper border border-rule overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink">
              <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Email</th>
              <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Role</th>
              <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Invited by</th>
              <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Invited at</th>
              <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Status</th>
              <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Accepted at</th>
              <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Note</th>
              <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const accepted = r.acceptedAt !== null;
              const expired = !accepted && r.expiresAt < now;
              const cancellable = !accepted && r.emailSendStatus !== "cancelled";
              return (
                <tr key={r.id} className="border-b border-rule hover:bg-paper-2 transition-colors">
                  <td className="px-6 py-4 font-serif text-ink">{r.email}</td>
                  <td className="px-6 py-4 font-mono text-[11px] tracking-eyebrow uppercase text-ink-2">{r.role}</td>
                  <td className="px-6 py-4 text-ink-3 text-sm">
                    {r.invitedBy.name ?? r.invitedBy.email}
                  </td>
                  <td className="px-6 py-4 font-mono text-[11px] text-ink-3">
                    {formatShortDate(r.createdAt)}
                  </td>
                  <td className="px-6 py-4">
                    <StatusPill
                      status={r.emailSendStatus}
                      accepted={accepted}
                      expired={expired}
                    />
                    {r.emailSendError && (
                      <div className="text-xs text-status-err mt-1 font-mono">
                        {r.emailSendError.slice(0, 80)}
                        {r.emailSendError.length > 80 ? "…" : ""}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 font-mono text-[11px] text-ink-3">
                    {formatShortDate(r.acceptedAt)}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {r.emailMismatchNote ? (
                      <span className="text-status-warn">{r.emailMismatchNote}</span>
                    ) : (
                      <span className="text-ink-4">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {cancellable ? (
                      <CancelInvitationButton invitationId={r.id} email={r.email} />
                    ) : (
                      <span className="text-ink-4 text-xs">—</span>
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
