import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";

export const metadata = {
  title: "Billing | bkstr",
};

export const dynamic = "force-dynamic";

// Phase 3 Stream 3 — Billing surface.
// Lists past PURCHASE-source access_grants for the current subscriber. SEED
// and MANUAL grants are intentionally excluded — they're operator-issued, not
// purchases the subscriber made. Future: Stripe Customer Portal embed (OQ-4
// refund flow) would land here. The Stripe Dashboard payment-intent link is a
// best-effort linkify — operators clicking through can verify the charge and,
// in Phase 4, issue refunds.

const STRIPE_DASHBOARD_BASE =
  process.env.NODE_ENV === "production"
    ? "https://dashboard.stripe.com/payments"
    : "https://dashboard.stripe.com/test/payments";

export default async function BillingPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const subscriber = await prisma.subscriber.findFirst({
    where: { user: { email: session.user.email } },
    select: { id: true, companyName: true },
  });
  const companyName = subscriber?.companyName ?? "Personal";
  const userEmail = session.user.email;
  const initial = (session.user.name?.[0] ?? userEmail[0] ?? "?").toUpperCase();

  const grants = subscriber
    ? await prisma.accessGrant.findMany({
        where: {
          subscriberId: subscriber.id,
          source: "PURCHASE",
        },
        orderBy: { grantedAt: "desc" },
        select: {
          id: true,
          grantedAt: true,
          revokedAt: true,
          stripePaymentIntentId: true,
          book: { select: { title: true, slug: true } },
        },
      })
    : [];

  return (
    <DashboardShell
      active="billing"
      companyName={companyName}
      userEmail={userEmail}
      initial={initial}
      role={session.user.role}
    >
      <header className="mb-8">
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-sm text-gray-500 mt-1">
          One-time book purchases via Stripe. Subscriptions are deferred to Phase 4.
        </p>
      </header>

      <div className="bg-[#FAF6EC] border border-[#E5DCC8] rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#EFE8D8] border-b border-[#E5DCC8]">
            <tr>
              <th className="px-6 py-4 font-semibold text-gray-600">Book</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Granted</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Status</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Stripe payment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5DCC8]">
            {grants.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                  No purchases yet. Buy a book from the{" "}
                  <a href="/dashboard" className="font-semibold underline hover:no-underline">
                    Active Books
                  </a>{" "}
                  page.
                </td>
              </tr>
            )}
            {grants.map((g) => {
              const piId = g.stripePaymentIntentId;
              return (
                <tr key={g.id} className="hover:bg-[#F5F0E6] transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-bold text-gray-900">{g.book.title}</div>
                    <div className="text-xs text-gray-500 font-mono mt-1">{g.book.slug}</div>
                  </td>
                  <td className="px-6 py-4">
                    <span title={g.grantedAt.toLocaleString()}>
                      {g.grantedAt.toLocaleDateString()}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {g.revokedAt ? (
                      <span className="inline-flex items-center gap-1.5 bg-[#EAE2D0] text-gray-600 px-2 py-1 rounded text-xs font-bold">
                        Revoked
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 bg-green-50 text-green-700 px-2 py-1 rounded text-xs font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> Active
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {piId ? (
                      <a
                        href={`${STRIPE_DASHBOARD_BASE}/${piId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-xs underline hover:no-underline text-gray-700"
                      >
                        {piId}
                      </a>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}
