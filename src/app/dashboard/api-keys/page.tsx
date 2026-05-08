import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { ApiKeysList } from "@/components/api-keys/api-keys-list";

export const metadata = {
  title: "API Keys | bkstr",
};

export default async function ApiKeysPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const subscriber = await prisma.subscriber.findFirst({
    where: { user: { email: session.user.email } },
    select: { companyName: true },
  });
  const companyName = subscriber?.companyName ?? "Personal";
  const userEmail = session.user.email;
  const initial = (session.user.name?.[0] ?? userEmail[0] ?? "?").toUpperCase();

  return (
    <DashboardShell active="api-keys" companyName={companyName} userEmail={userEmail} initial={initial}>
      <ApiKeysList />
    </DashboardShell>
  );
}
