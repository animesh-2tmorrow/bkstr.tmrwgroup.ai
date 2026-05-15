import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashShell, Eyebrow } from "@/components/design";
import { ApiKeysList } from "@/components/api-keys/api-keys-list";
import { buildDashNav } from "@/lib/dashboard/nav-config";

export const metadata = {
  title: "API Keys | bkstr",
};

// bkstr redesign PR 7 — migrated to <DashShell> + design-token header.
// The header lives on the page (not inside ApiKeysList) so the
// "Generate new key" CTA stays inside the client island where its modal
// state lives.
export default async function ApiKeysPage() {
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
      nav={buildDashNav(session.user.role, "/dashboard/api-keys")}
      brandSubtitle={companyName.toUpperCase()}
      userBlock={<UserBlock email={userEmail} />}
    >
      <ApiKeysList />
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
