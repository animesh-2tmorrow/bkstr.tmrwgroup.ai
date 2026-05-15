import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashShell, Eyebrow } from "@/components/design";
import { buildDashNav } from "@/lib/dashboard/nav-config";

export const metadata = {
  title: "Usage Metrics | bkstr",
};

export const dynamic = "force-dynamic";

// bkstr redesign PR 7 — Coming-soon stub for /dashboard/usage. The nav-config
// has pointed at this href since PR 3; today the link 404s. This stub closes
// that loop: signed-in users land on a token-styled placeholder that names
// what's coming and what /fetch-logs already provides today.
//
// When real usage rollups land, replace the placeholder body with the actual
// surface; the shell + header pattern stays.
export default async function UsagePage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const subscriber = await prisma.subscriber.findFirst({
    where: { user: { email: session.user.email } },
    select: { companyName: true },
  });
  const companyName = subscriber?.companyName ?? "Personal";
  const userEmail = session.user.email;

  return (
    <DashShell
      nav={buildDashNav(session.user.role, "/dashboard/usage")}
      brandSubtitle={companyName.toUpperCase()}
      userBlock={<UserBlock email={userEmail} />}
    >
      <header className="mb-8">
        <Eyebrow>§ OBSV · USAGE METRICS (PREVIEW)</Eyebrow>
        <h1 className="font-serif font-normal text-[36px] leading-[1.05] tracking-display text-ink mt-3 mb-2">
          Usage Metrics
        </h1>
        <p className="text-ink-3 text-sm max-w-[72ch]">
          Aggregate fetch volume, token consumption, and per-book trend lines
          for your fleet. Coming soon.
        </p>
      </header>

      <div className="bg-paper border border-rule p-10 max-w-[60ch]">
        <Eyebrow>WHAT YOU CAN DO TODAY</Eyebrow>
        <p className="text-ink-2 text-sm leading-[1.65] mt-3">
          The 4-stat strip on{" "}
          <a href="/dashboard" className="text-ink underline hover:no-underline">
            Active Books
          </a>{" "}
          shows volumes owned, 30-day fetches, active agents, and tokens
          served. The{" "}
          <a href="/dashboard/fetch-logs" className="text-ink underline hover:no-underline">
            Fetch Logs
          </a>{" "}
          surface lists the most recent 100 calls with status, latency, and
          token counts per row.
        </p>
        <p className="text-ink-3 text-sm leading-[1.65] mt-4">
          The dedicated rollup view will land here. Until then those two
          surfaces cover the same ground.
        </p>
      </div>
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
