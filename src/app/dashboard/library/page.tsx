import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { LibraryTable, type LibraryFilter } from "@/components/dashboard/library-table";
import { getBooksForLibrary, getBookAccessStates } from "@/lib/dashboard/queries";

// Phase 4 Stream C — Library route (CC-13).
// Server-renders the catalog filtered by an Active / Browse / All tab whose
// state lives in `?filter=…` so the view is link-shareable + refresh-stable.
// Default filter is "all" (no URL) — the operator's preference is to land
// every signed-in user on the catalog overview and let them tab to their
// own granted books. No client useState anywhere on this page.

export const metadata = {
  title: "Library | bkstr",
};

export const dynamic = "force-dynamic";

function parseFilter(raw: string | string[] | undefined): LibraryFilter {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "active" || v === "browse" || v === "all") return v;
  return "all";
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const params = await searchParams;
  const filter = parseFilter(params.filter);

  const subscriber = await prisma.subscriber.findFirst({
    where: { user: { email: session.user.email } },
    select: { id: true, companyName: true },
  });
  const companyName = subscriber?.companyName ?? "Personal";
  const userEmail = session.user.email;
  const initial = (session.user.name?.[0] ?? userEmail[0] ?? "?").toUpperCase();

  const [books, accessByBook] = await Promise.all([
    getBooksForLibrary(),
    subscriber ? getBookAccessStates(subscriber.id) : Promise.resolve(undefined),
  ]);

  return (
    <DashboardShell
      active="library"
      companyName={companyName}
      userEmail={userEmail}
      initial={initial}
      role={session.user.role}
    >
      <header className="mb-8">
        <h1 className="text-2xl font-bold">Library</h1>
        <p className="text-sm text-gray-500 mt-1">
          Browse the catalog, buy access to a book, or view / download books
          you already own.
        </p>
      </header>

      <LibraryTable
        subscriberId={subscriber?.id ?? null}
        books={books}
        accessByBook={accessByBook}
        filter={filter}
      />
    </DashboardShell>
  );
}
