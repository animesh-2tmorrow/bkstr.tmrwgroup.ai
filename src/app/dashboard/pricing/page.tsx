import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { PricingForm } from "@/components/dashboard/pricing-form";
import { getPricingBooks } from "@/lib/dashboard/queries";
import { Role } from "@/generated/prisma/client";

export const metadata = {
  title: "Pricing | bkstr",
};

export const dynamic = "force-dynamic";

// Phase 4 Stream B — Pricing surface scope: PUBLISHER sees only their own
// books (filtered via book.publisher_user_id == session.user.id); ADMIN sees
// every book. SUBSCRIBER is redirected away. The server-side redirect is the
// defense-in-depth check that complements the role-aware nav filtering in
// DashboardShell.
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
  const initial = (session.user.name?.[0] ?? userEmail[0] ?? "?").toUpperCase();

  // Phase 4 Stream B — publisher-scoped pricing list (see getPricingBooks).
  // Scenario B — PUBLISHER: only own books. Scenario E — ADMIN: all books.
  const rows = await getPricingBooks({ id: session.user.id, role: session.user.role });

  const isPublisher = session.user.role === Role.PUBLISHER;

  return (
    <DashboardShell active="pricing" companyName={companyName} userEmail={userEmail} initial={initial} role={session.user.role}>
      <header className="mb-8">
        <h1 className="text-2xl font-bold">Pricing</h1>
        <p className="text-sm text-gray-500 mt-1">
          {isPublisher
            ? "Set or update USD pricing for the books you publish. Submitting creates a fresh Stripe Price (Stripe Prices are immutable) and repoints this book's active price."
            : "Set or update USD pricing for each book. Submitting creates a fresh Stripe Price object (Stripe Prices are immutable) and repoints this book's active price."}
        </p>
      </header>

      <PricingForm books={rows} isPublisher={isPublisher} />
    </DashboardShell>
  );
}
