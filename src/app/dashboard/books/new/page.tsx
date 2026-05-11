import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { NewBookForm } from "@/components/dashboard/new-book-form";
import { Role } from "@/generated/prisma/client";

export const metadata = {
  title: "New Book | bkstr",
};

export const dynamic = "force-dynamic";

// Phase 4 Stream B — new-book authoring surface. PUBLISHER + ADMIN only;
// SUBSCRIBER (or anyone unauthenticated) is server-side-redirected away.
// This redirect is the load-bearing route guard; the nav-filter in
// DashboardShell is UI-affordance only.
export default async function NewBookPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  if (session.user.role !== Role.PUBLISHER && session.user.role !== Role.ADMIN) {
    // Scenario D — SUBSCRIBER hits /dashboard/books/new directly, gets kicked.
    redirect("/dashboard");
  }

  const subscriber = await prisma.subscriber.findFirst({
    where: { user: { email: session.user.email } },
    select: { companyName: true },
  });
  const companyName = subscriber?.companyName ?? "Personal";
  const userEmail = session.user.email;
  const initial = (session.user.name?.[0] ?? userEmail[0] ?? "?").toUpperCase();

  return (
    <DashboardShell
      active="new-book"
      companyName={companyName}
      userEmail={userEmail}
      initial={initial}
      role={session.user.role}
    >
      <header className="mb-8">
        <h1 className="text-2xl font-bold">New Book</h1>
        <p className="text-sm text-gray-500 mt-1">
          Publish a new book to the bkstr marketplace. Submitting creates a Stripe Product and Price,
          inserts the book + first version + USD price locally, and grants you authoring access. You can
          edit pricing later from the Pricing tab.
        </p>
      </header>

      <NewBookForm />
    </DashboardShell>
  );
}
