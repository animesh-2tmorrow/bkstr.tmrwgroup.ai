import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashShell, Eyebrow } from "@/components/design";
import { PricingForm } from "@/components/dashboard/pricing-form";
import { getPricingBooks } from "@/lib/dashboard/queries";
import { Role } from "@/generated/prisma/client";
import { buildDashNav } from "@/lib/dashboard/nav-config";

export const metadata = {
  title: "Pricing | bkstr",
};

export const dynamic = "force-dynamic";

// Phase 4 Stream B — Pricing surface scope: PUBLISHER sees only their own
// books (filtered via book.publisher_user_id == session.user.id); ADMIN sees
// every book. SUBSCRIBER is redirected away. The server-side redirect is the
// defense-in-depth check that complements the role-aware nav filtering.
//
// bkstr redesign PR 6 — migrated to <DashShell> + design-token header.
export default async function PricingPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  if (session.user.role !== Role.ADMIN && session.user.role !== Role.PUBLISHER) {
    // Scenario D — SUBSCRIBER lands here, gets kicked to /dashboard.
    redirect("/dashboard");
  }

  const subscriber = await prisma.subscriber.findFirst({
    where: { user: { email: session.user.email } },
    select: { companyName: true },
  });
  const companyName = subscriber?.companyName ?? "Personal";
  const userEmail = session.user.email;

  // Phase 4 Stream B — publisher-scoped pricing list (see getPricingBooks).
  // Scenario B — PUBLISHER: only own books. Scenario E — ADMIN: all books.
  const rows = await getPricingBooks({ id: session.user.id, role: session.user.role });

  const isPublisher = session.user.role === Role.PUBLISHER;

  return (
    <DashShell
      nav={buildDashNav(session.user.role, "/dashboard/pricing")}
      brandSubtitle={companyName.toUpperCase()}
      userBlock={<UserBlock email={userEmail} />}
    >
      <header className="mb-8">
        <Eyebrow>§ PUBLISH · USD PRICE LEDGER</Eyebrow>
        <h1 className="font-serif font-normal text-[36px] leading-[1.05] tracking-display text-ink mt-3 mb-2">
          Pricing
        </h1>
        <p className="text-ink-3 text-sm max-w-[72ch]">
          {isPublisher
            ? "Set or update USD pricing for the books you publish. Submitting creates a fresh Stripe Price (Stripe Prices are immutable) and repoints this book's active price."
            : "Set or update USD pricing for each book. Submitting creates a fresh Stripe Price object (Stripe Prices are immutable) and repoints this book's active price."}
        </p>
      </header>

      <PricingForm books={rows} isPublisher={isPublisher} />
    </DashShell>
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
