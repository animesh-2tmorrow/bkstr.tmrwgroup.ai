import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { PricingForm } from "@/components/dashboard/pricing-form";

export const metadata = {
  title: "Pricing | bkstr",
};

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const subscriber = await prisma.subscriber.findFirst({
    where: { user: { email: session.user.email } },
    select: { companyName: true },
  });
  const companyName = subscriber?.companyName ?? "Personal";
  const userEmail = session.user.email;
  const initial = (session.user.name?.[0] ?? userEmail[0] ?? "?").toUpperCase();

  // Books with their current USD price (if any). Empty list → operator hasn't
  // imported books yet; the form's selector will be empty and submit disabled.
  const books = await prisma.book.findMany({
    select: {
      id: true,
      title: true,
      slug: true,
      domain: true,
      prices: {
        where: { currency: "USD" },
        select: { unitAmountCents: true, stripePriceId: true, updatedAt: true },
        take: 1,
      },
    },
    orderBy: { title: "asc" },
  });

  const rows = books.map((b) => ({
    id: b.id,
    title: b.title,
    slug: b.slug,
    domain: b.domain,
    unitAmountCents: b.prices[0]?.unitAmountCents ?? null,
    stripePriceId: b.prices[0]?.stripePriceId ?? null,
    updatedAt: b.prices[0]?.updatedAt?.toISOString() ?? null,
  }));

  return (
    <DashboardShell active="pricing" companyName={companyName} userEmail={userEmail} initial={initial} role={session.user.role}>
      <header className="mb-8">
        <h1 className="text-2xl font-bold">Pricing</h1>
        <p className="text-sm text-gray-500 mt-1">
          Set or update USD pricing for each book. Submitting creates a fresh Stripe Price object
          (Stripe Prices are immutable) and repoints this book&apos;s active price.
        </p>
      </header>

      <PricingForm books={rows} />
    </DashboardShell>
  );
}
