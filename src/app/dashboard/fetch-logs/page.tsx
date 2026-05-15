import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashShell, Eyebrow } from "@/components/design";
import { FetchLogsTable } from "@/components/dashboard/fetch-logs-table";
import { RefreshButton } from "@/components/dashboard/refresh-button";
import { getRecentFetchLogs, getBookTitle } from "@/lib/dashboard/queries";
import { buildDashNav } from "@/lib/dashboard/nav-config";

export const metadata = {
  title: "Fetch Logs | bkstr",
};

export const dynamic = "force-dynamic";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// bkstr redesign PR 7 — migrated to <DashShell> + design-token header.
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

  const params = await searchParams;
  const filterBookId = params.book && UUID_REGEX.test(params.book) ? params.book : null;
  const [rows, filterBookTitle] = subscriber
    ? await Promise.all([
        getRecentFetchLogs({ subscriberId: subscriber.id, bookId: filterBookId ?? undefined }),
        filterBookId ? getBookTitle(filterBookId) : Promise.resolve(null),
      ])
    : [[], null];

  return (
    <DashShell
      nav={buildDashNav(session.user.role, "/dashboard/fetch-logs")}
      brandSubtitle={companyName.toUpperCase()}
      userBlock={<UserBlock email={userEmail} />}
    >
      <header className="mb-8 flex justify-between items-end gap-4">
        <div>
          <Eyebrow>§ OBSV · BEDROCK FETCH LEDGER</Eyebrow>
          <h1 className="font-serif font-normal text-[36px] leading-[1.05] tracking-display text-ink mt-3 mb-2">
            Fetch Logs
          </h1>
          <p className="text-ink-3 text-sm max-w-[72ch]">
            Every Bedrock call your subscribers have made, last 100 rows.
            Filter by book using the storefront link or query param.
          </p>
        </div>
        <RefreshButton />
      </header>

      <FetchLogsTable rows={rows} filterBookTitle={filterBookTitle} filterBookId={filterBookId} />
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
