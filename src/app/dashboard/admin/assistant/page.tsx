import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { AssistantPane } from "@/components/dashboard/admin/assistant-pane";

export const metadata = {
  title: "Admin · Assistant | bkstr",
};

// Phase 5 Stream B (D14.1) — admin AI assistant page. ADMIN gate inherited
// from /dashboard/admin/layout.tsx; defense-in-depth re-check below for the
// session.user.id we need to scope the conversation list.
export const dynamic = "force-dynamic";

export default async function AdminAssistantPage() {
  const session = await auth();
  if (!session?.user?.email || !session.user.id) redirect("/login");

  const userEmail = session.user.email;
  const initial = (session.user.name?.[0] ?? userEmail[0] ?? "?").toUpperCase();

  // Server-side initial fetch of the admin's non-archived conversations so
  // the first paint shows the rail populated. The client component refetches
  // after every mutation (new/delete) for the up-to-date state.
  const [subscriber, conversations] = await Promise.all([
    prisma.subscriber.findFirst({
      where: { user: { email: userEmail } },
      select: { companyName: true },
    }),
    prisma.assistantConversation.findMany({
      where: { ownerUserId: session.user.id, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    }),
  ]);

  const companyName = subscriber?.companyName ?? "Personal";
  const initialConversations = conversations.map((c) => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt.toISOString(),
    messageCount: c._count.messages,
  }));

  return (
    <DashboardShell
      active="admin-assistant"
      companyName={companyName}
      userEmail={userEmail}
      initial={initial}
      role={session.user.role}
    >
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Admin · Assistant</h1>
        <p className="text-sm text-gray-500 mt-1">
          Ask anything about platform state. The assistant has read-only access to
          users, books, grants, the audit log, and recent fetch logs. It cannot
          make changes (Phase 5 Stream B is read-only per D14.1; Streams C + D
          will add propose / execute modes).
        </p>
      </header>

      <AssistantPane initialConversations={initialConversations} />
    </DashboardShell>
  );
}
