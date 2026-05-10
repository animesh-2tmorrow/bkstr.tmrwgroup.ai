import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { BooksTable } from "@/components/dashboard/books-table";
import { RefreshButton } from "@/components/dashboard/refresh-button";
import { getBooksWithMetrics, getBookAccessStates } from "@/lib/dashboard/queries";

export const metadata = {
  title: "Dashboard | bkstr",
};

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const subscriber = await prisma.subscriber.findFirst({
    where: { user: { email: session.user.email } },
    select: { id: true, companyName: true },
  });
  const companyName = subscriber?.companyName ?? "Personal";
  const userEmail = session.user.email;
  const initial = (session.user.name?.[0] ?? userEmail[0] ?? "?").toUpperCase();

  const [books, accessByBook] = await Promise.all([
    getBooksWithMetrics(),
    subscriber ? getBookAccessStates(subscriber.id) : Promise.resolve(undefined),
  ]);

  return (
    <DashboardShell
      active="books"
      companyName={companyName}
      userEmail={userEmail}
      initial={initial}
      role={session.user.role}
    >
      <header className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Active Books</h1>
          <p className="text-sm text-gray-500 mt-1">
            Knowledge available to your agent fleet.
          </p>
        </div>
        <RefreshButton />
      </header>

      <BooksTable books={books} accessByBook={accessByBook} />
    </DashboardShell>
  );
}
