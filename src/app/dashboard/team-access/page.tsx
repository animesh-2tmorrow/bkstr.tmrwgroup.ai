import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashShell, Eyebrow } from "@/components/design";
import { buildDashNav } from "@/lib/dashboard/nav-config";
import { Role } from "@/generated/prisma/client";

export const metadata = {
  title: "Team Access | bkstr",
};

export const dynamic = "force-dynamic";

// bkstr redesign PR 7 — Coming-soon stub for /dashboard/team-access. Like
// /dashboard/usage, the nav-config has pointed at this href since PR 3 and
// it has been 404-ing. The placeholder names what's coming and points
// existing operators at the surfaces that already cover most of the ground
// (Admin · Users for ADMIN; API Keys for everyone else).
export default async function TeamAccessPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const subscriber = await prisma.subscriber.findFirst({
    where: { user: { email: session.user.email } },
    select: { companyName: true },
  });
  const companyName = subscriber?.companyName ?? "Personal";
  const userEmail = session.user.email;
  const isAdmin = session.user.role === Role.ADMIN;

  return (
    <DashShell
      nav={buildDashNav(session.user.role, "/dashboard/team-access")}
      brandSubtitle={companyName.toUpperCase()}
      userBlock={<UserBlock email={userEmail} />}
    >
      <header className="mb-8">
        <Eyebrow>§ ACCESS · TEAM (PREVIEW)</Eyebrow>
        <h1 className="font-serif font-normal text-[36px] leading-[1.05] tracking-display text-ink mt-3 mb-2">
          Team Access
        </h1>
        <p className="text-ink-3 text-sm max-w-[72ch]">
          Per-tenant team rosters, scoped roles, and seat invites. Coming
          soon.
        </p>
      </header>

      <div className="bg-paper border border-rule p-10 max-w-[60ch]">
        <Eyebrow>WHAT YOU CAN DO TODAY</Eyebrow>
        {isAdmin ? (
          <p className="text-ink-2 text-sm leading-[1.65] mt-3">
            Use{" "}
            <a
              href="/dashboard/admin/users"
              className="text-ink underline hover:no-underline"
            >
              Admin · Users
            </a>{" "}
            to invite new operators, change roles, and view the platform
            roster. The dedicated tenant-scoped team surface will land here.
          </p>
        ) : (
          <p className="text-ink-2 text-sm leading-[1.65] mt-3">
            Issue per-agent credentials at{" "}
            <a
              href="/dashboard/api-keys"
              className="text-ink underline hover:no-underline"
            >
              API Keys
            </a>{" "}
            — each key is independently revocable and scoped to your account.
            Tenant-level team management lands here next.
          </p>
        )}
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
