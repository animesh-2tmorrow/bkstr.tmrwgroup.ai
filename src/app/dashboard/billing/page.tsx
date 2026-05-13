import { redirect } from "next/navigation";
import Link from "next/link";
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
//
// Phase 5 Stream H.1 — replaced toLocaleDateString() with a stable ISO date
// helper to fix the React #418 hydration mismatch caught in the v1 audit.
// Empty-state link routes to /storefront (the public ecommerce surface from
// Stream H.1) so an empty buyer is funneled into the catalog rather than
// bouncing back to their own empty Active Books table.

const STRIPE_DASHBOARD_BASE =
  process.env.NODE_ENV === "production"
    ? "https://dashboard.stripe.com/payments"
    : "https://dashboard.stripe.com/test/payments";

// Format a Date as a stable ISO date string (YYYY-MM-DD) to avoid React #418
// hydration mismatch caused by toLocaleDateString() rendering differently on
// server vs. client when locale or timezone differs.
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

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
          // Phase 6 Stream L: a PURCHASE grant points at either a book or a
          // skill (XOR-checked at the DB layer). Select both; the table renders
          // whichever is non-null, with "—" as a defensive fallback.
          book: { select: { title: true, slug: true } },
          skill: { select: { name: true, slug: true } },
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
                <td colSpan={4} className="px-6 py-10 text-center text-gray-500">
                  No purchases yet.{" "}
                  <Link
                    href="/storefront"
                    className="font-semibold text-gray-900 underline hover:no-underline"
                  >
                    Browse the storefront
                  </Link>{" "}
                  to buy a book.
                </td>
              </tr>
            )}
            {grants.map((g) => {
              const piId = g.stripePaymentIntentId;
              // Stream L: a grant points at either a book or a skill. Render
              // whichever is non-null; show "—" as a defensive fallback (the
              // XOR CHECK at the DB layer ensures exactly one is set, so the
              // fallback should never render in practice).
              const targetTitle = g.book?.title ?? g.skill?.name ?? "—";
              const targetSlug = g.book?.slug ?? g.skill?.slug ?? "—";
              const targetKind = g.book ? "Book" : g.skill ? "Skill" : null;
              return (
                <tr key={g.id} className="hover:bg-[#F5F0E6] transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-bold text-gray-900">{targetTitle}</div>
                    <div className="text-xs text-gray-500 font-mono mt-1">
                      {targetSlug}
                      {targetKind && (
                        <span className="ml-2 text-gray-400">· {targetKind}</span>
                      )}
                    </div>
                  </td>
                  {/* Use stable ISO date to avoid React #418 hydration mismatch */}
                  <td className="px-6 py-4 tabular-nums text-gray-700">
                    {isoDate(g.grantedAt)}
                  </td>
                  <td className="px-6 py-4">
                    {g.revokedAt ? (
                      <span className="inline-flex items-center gap-1.5 bg-[#EAE2D0] text-gray-600 px-2.5 py-1 rounded-md text-xs font-semibold">
                        Revoked
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 bg-green-50 text-green-700 px-2.5 py-1 rounded-md text-xs font-semibold border border-green-100">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                        Active
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {piId ? (
                      <a
                        href={`${STRIPE_DASHBOARD_BASE}/${piId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-xs text-gray-600 underline hover:no-underline hover:text-black transition-colors"
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
