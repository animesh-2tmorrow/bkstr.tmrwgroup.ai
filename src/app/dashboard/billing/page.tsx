import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  DashShell,
  Eyebrow,
  StatCard,
  BookCover,
  Pill,
} from "@/components/design";
import { buildDashNav } from "@/lib/dashboard/nav-config";
import { getBillingStats } from "@/lib/dashboard/queries";
import type { BookCoverPalette } from "@/components/design/book-cover";

// bkstr redesign PR 3 — Billing on the new <DashShell>.
//
// Per HANDOFF.md page-by-page §billing + dispatch §6 copy audit:
//   - 4-stat strip: Volumes Owned / Lifetime Spend / Effective Per Fetch /
//     Refunds Available — replaces the prior placeholder "Subscriptions
//     deferred to Phase 4" subtitle.
//   - Per-book purchases table: Book / Granted / Amount / Status /
//     Stripe payment ID + invoice link slot.
//
// Copy audit grep (HANDOFF pricing-critical, dispatch §6 reminder):
//   "Current plan"   -> "Volumes owned"           (now stat label)
//   "Next invoice"   -> "Refunds available"       (now stat label)
//   "monthly"        -> "one-time"                (subtitle)
//   "seat"           -> "purchase"                (n/a — wasn't here)
//   "/agent/mo"      -> ""                        (n/a — wasn't here)
//   "free trial"     -> "sign up free"            (n/a — wasn't here)
//   "Subscriptions deferred to Phase 4" -> removed
// The prior /billing subtitle "One-time book purchases via Stripe.
// Subscriptions are deferred to Phase 4." carried both correct framing
// AND a Phase-4 placeholder. The placeholder goes; the framing stays.

export const metadata = { title: "Billing | bkstr" };
export const dynamic = "force-dynamic";

const STRIPE_DASHBOARD_BASE =
  process.env.NODE_ENV === "production"
    ? "https://dashboard.stripe.com/payments"
    : "https://dashboard.stripe.com/test/payments";

// Stable ISO date helper — same as Stream H.1 to dodge React #418
// hydration mismatch on toLocaleDateString().
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Cents → "$X" or "$X.XX". Used for stat values and table line items.
function dollars(cents: number, opts: { decimals?: 0 | 2 } = {}): string {
  const decimals = opts.decimals ?? 0;
  return `$${(cents / 100).toFixed(decimals)}`;
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

  const [grants, stats] = await Promise.all([
    subscriber
      ? prisma.accessGrant.findMany({
          where: { subscriberId: subscriber.id, source: "PURCHASE" },
          orderBy: { grantedAt: "desc" },
          select: {
            id: true,
            grantedAt: true,
            revokedAt: true,
            stripePaymentIntentId: true,
            book: {
              select: {
                title: true,
                slug: true,
                domain: true,
                // PR 8 — palette + glyph drive the per-row BookCover SVG.
                palette: true,
                glyph: true,
                prices: {
                  where: { currency: "USD" },
                  select: { unitAmountCents: true },
                  take: 1,
                },
              },
            },
            // Stream L: PURCHASE grant XOR-points at book OR skill.
            skill: { select: { name: true, slug: true } },
          },
        })
      : Promise.resolve([]),
    subscriber
      ? getBillingStats(subscriber.id)
      : Promise.resolve({
          volumesOwned: 0,
          lifetimeSpendCents: 0,
          totalFetches: 0,
          refundsAvailableCents: 0,
          refundsAvailableCount: 0,
        }),
  ]);

  // Effective per-fetch — only meaningful if there's been any spend AND any
  // fetches. Show three significant figures (max 4 chars after the $)
  // because $0.018 / $0.0042 etc. are common.
  const effectivePerFetch =
    stats.totalFetches > 0 && stats.lifetimeSpendCents > 0
      ? `$${(stats.lifetimeSpendCents / stats.totalFetches / 100).toFixed(3)}`
      : "—";

  return (
    <DashShell
      nav={buildDashNav(session.user.role, "/dashboard/billing")}
      brandSubtitle={companyName.toUpperCase()}
      userBlock={<UserBlock email={userEmail} />}
    >
      {/* Header — copy audit cleaned (no monthly/subscription/trial copy) */}
      <div className="flex justify-between items-end gap-6 mb-8">
        <div>
          <Eyebrow>§ BLNG · ONE-TIME BOOK PURCHASES</Eyebrow>
          <h1 className="font-serif font-normal text-[36px] leading-[1.05] tracking-display text-ink mt-3 mb-2">
            Billing
          </h1>
          <p className="text-ink-3 text-sm max-w-[60ch]">
            Each volume is a one-time purchase. No subscriptions, no monthly
            invoices. Refunds within 14 days of purchase, processed back to
            your original payment method.
          </p>
        </div>
      </div>

      {/* 4-stat strip — replaces "Current plan / Next invoice" framing */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-rule mb-8">
        <StatCard
          label="VOLUMES OWNED"
          value={stats.volumesOwned}
          delta={
            stats.volumesOwned > 0
              ? "active grants on PURCHASE source"
              : "none yet"
          }
          className="border-0"
        />
        <StatCard
          label="LIFETIME SPEND"
          value={
            <>
              {dollars(stats.lifetimeSpendCents)}
              <span className="text-ink-3 text-sm">.00</span>
            </>
          }
          delta={`across ${stats.volumesOwned} ${stats.volumesOwned === 1 ? "volume" : "volumes"}`}
          className="border-0"
        />
        <StatCard
          label="EFFECTIVE / FETCH"
          value={effectivePerFetch}
          delta={
            stats.totalFetches > 0
              ? `over ${stats.totalFetches.toLocaleString()} ${stats.totalFetches === 1 ? "fetch" : "fetches"}`
              : "no fetches yet"
          }
          className="border-0"
        />
        <StatCard
          label="REFUNDS AVAILABLE"
          value={
            <>
              {dollars(stats.refundsAvailableCents)}
              <span className="text-ink-3 text-sm">.00</span>
            </>
          }
          delta={
            stats.refundsAvailableCount > 0
              ? `on ${stats.refundsAvailableCount} purchase${stats.refundsAvailableCount === 1 ? "" : "s"} ≤14d old`
              : "no recent purchases"
          }
          className="border-0"
        />
      </div>

      {/* Section divider before the purchases table */}
      <div className="flex items-center gap-4 mb-5">
        <Eyebrow className="tracking-section">§ PURCHASES · PER-BOOK</Eyebrow>
        <span aria-hidden className="flex-1 h-px bg-ink" />
        <Eyebrow className="tracking-section">
          {grants.length} {grants.length === 1 ? "ROW" : "ROWS"}
        </Eyebrow>
      </div>

      {/* Purchases table */}
      <div className="bg-paper border border-rule overflow-hidden">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-ink">
              <Th className="w-[34%]">Item</Th>
              <Th>Granted</Th>
              <Th className="text-right">Amount</Th>
              <Th>Status</Th>
              <Th>Stripe payment</Th>
            </tr>
          </thead>
          <tbody>
            {grants.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-ink-3">
                  No purchases yet.{" "}
                  <Link
                    href="/storefront"
                    className="font-mono uppercase tracking-eyebrow text-[11px] text-ink underline hover:no-underline"
                  >
                    Browse the storefront →
                  </Link>
                </td>
              </tr>
            )}
            {grants.map((g, idx) => {
              const piId = g.stripePaymentIntentId;
              const isLast = idx === grants.length - 1;
              const targetTitle = g.book?.title ?? g.skill?.name ?? "—";
              const targetSlug = g.book?.slug ?? g.skill?.slug ?? "—";
              const targetDomain = g.book?.domain ?? null;
              const targetKind = g.book ? "Book" : g.skill ? "Skill" : null;
              const cents = g.book?.prices?.[0]?.unitAmountCents ?? null;
              return (
                <tr
                  key={g.id}
                  className={
                    "transition-colors hover:bg-paper-2 align-top " +
                    (isLast ? "" : "border-b border-rule")
                  }
                >
                  <td className="px-4 py-4">
                    <div className="flex gap-3.5 items-start">
                      {targetDomain && g.book ? (
                        <div className="shrink-0">
                          <BookCover
                            book={{
                              title: targetTitle,
                              glyph: g.book.glyph,
                              domain: targetDomain,
                              palette: g.book.palette as BookCoverPalette,
                              vol: "Vol. 01",
                              version: "v1",
                              author: "—",
                            }}
                            size="xs"
                            flat
                          />
                        </div>
                      ) : null}
                      <div>
                        <div className="font-serif text-[15.5px] tracking-tight text-ink">
                          {targetTitle}
                        </div>
                        <div className="font-mono text-[11px] text-ink-3 mt-1">
                          {targetSlug}
                          {targetKind && (
                            <span className="ml-1.5 text-ink-4">
                              · {targetKind}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4 font-mono text-xs text-ink-2 num">
                    {isoDate(g.grantedAt)}
                  </td>
                  <td className="px-4 py-4 text-right num">
                    {cents !== null ? (
                      <span className="font-serif text-[18px] text-ink">
                        {dollars(cents)}
                        <span className="text-ink-3 text-xs">.00</span>
                      </span>
                    ) : (
                      <span className="text-ink-4">—</span>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    {g.revokedAt ? (
                      <Pill variant="status-err">○ Revoked</Pill>
                    ) : (
                      <Pill variant="status-ok">● Owned</Pill>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    {piId ? (
                      <a
                        href={`${STRIPE_DASHBOARD_BASE}/${piId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-xs text-saffron-dk underline hover:no-underline"
                      >
                        {piId}
                      </a>
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

      {/* Footer line — small reassurance copy */}
      <div className="mt-3 text-ink-3 text-xs flex justify-between items-baseline">
        <Eyebrow>ALL AMOUNTS USD · 14-DAY REFUND</Eyebrow>
      </div>
    </DashShell>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={
        "px-4 py-3 font-mono font-medium text-[10.5px] uppercase tracking-eyebrow text-ink-3 " +
        className
      }
    >
      {children}
    </th>
  );
}

function UserBlock({ email }: { email: string }) {
  return (
    <>
      <div className="text-ink text-[13px] mb-1 truncate">{email}</div>
      <div className="flex justify-between items-center text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="w-1.5 h-1.5 rounded-full bg-status-ok inline-block"
          />
          Signed in
        </span>
        <a
          href="/api/auth/signout"
          className="text-ink-3 hover:text-ink transition-colors"
        >
          Log out
        </a>
      </div>
    </>
  );
}
