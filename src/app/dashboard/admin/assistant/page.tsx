import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashShell, Eyebrow } from "@/components/design";
import { AssistantPane } from "@/components/dashboard/admin/assistant-pane";
import { buildDashNav } from "@/lib/dashboard/nav-config";

export const metadata = {
  title: "Admin · Assistant | bkstr",
};

// Phase 5 Stream B (D14.1) — admin AI assistant page. ADMIN gate inherited
// from /dashboard/admin/layout.tsx; defense-in-depth re-check below for the
// session.user.id we need to scope the conversation list.
//
// bkstr redesign PR 5 — migrated to <DashShell> + design-token header.
export const dynamic = "force-dynamic";

export default async function AdminAssistantPage() {
  const session = await auth();
  if (!session?.user?.email || !session.user.id) redirect("/login");

  const userEmail = session.user.email;

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
    <DashShell
      nav={buildDashNav(session.user.role, "/dashboard/admin/assistant")}
      brandSubtitle={companyName.toUpperCase()}
      userBlock={<UserBlock email={userEmail} />}
    >
      <header className="mb-6">
        <Eyebrow>§ ADMN · READ-ONLY PLATFORM ASSISTANT</Eyebrow>
        <h1 className="font-serif font-normal text-[36px] leading-[1.05] tracking-display text-ink mt-3 mb-2">
          Assistant
        </h1>
        <p className="text-ink-3 text-sm max-w-[72ch]">
          Ask anything about platform state. The assistant has read-only
          access to users, books, grants, the audit log, and recent fetch
          logs. It cannot make changes (Phase 5 Stream B is read-only per
          D14.1; Streams C + D will add propose / execute modes).
        </p>
      </header>

      <AssistantPane initialConversations={initialConversations} />
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
