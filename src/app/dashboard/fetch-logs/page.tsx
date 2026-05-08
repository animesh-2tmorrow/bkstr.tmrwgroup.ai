import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { FetchLogsTable } from "@/components/dashboard/fetch-logs-table";
import { RefreshButton } from "@/components/dashboard/refresh-button";
import { getRecentFetchLogs, getBookTitle } from "@/lib/dashboard/queries";

export const metadata = {
  title: "Fetch Logs | bkstr",
};

export const dynamic = "force-dynamic";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function FetchLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const subscriber = await prisma.subscriber.findFirst({
    where: { user: { email: session.user.email } },
    select: { id: true, companyName: true },
  });
  const companyName = subscriber?.companyName ?? "Personal";
  const userEmail = session.user.email;
  const initial = (session.user.name?.[0] ?? userEmail[0] ?? "?").toUpperCase();

  const params = await searchParams;
  const filterBookId = params.book && UUID_REGEX.test(params.book) ? params.book : null;
  const [rows, filterBookTitle] = subscriber
    ? await Promise.all([
        getRecentFetchLogs({ subscriberId: subscriber.id, bookId: filterBookId ?? undefined }),
        filterBookId ? getBookTitle(filterBookId) : Promise.resolve(null),
      ])
    : [[], null];

  return (
    <DashboardShell active="fetch-logs" companyName={companyName} userEmail={userEmail} initial={initial}>
      <header className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Fetch Logs</h1>
          <p className="text-sm text-gray-500 mt-1">
            Every Bedrock call your subscribers have made, last 100 rows.
          </p>
        </div>
        <RefreshButton />
      </header>

      <FetchLogsTable rows={rows} filterBookTitle={filterBookTitle} filterBookId={filterBookId} />
    </DashboardShell>
  );
}
