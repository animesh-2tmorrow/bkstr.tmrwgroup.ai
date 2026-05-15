import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashShell, Eyebrow } from "@/components/design";
import { NewBookForm } from "@/components/dashboard/new-book-form";
import { Role } from "@/generated/prisma/client";
import { buildDashNav } from "@/lib/dashboard/nav-config";

export const metadata = {
  title: "New Book | bkstr",
};

export const dynamic = "force-dynamic";

// Phase 4 Stream B — new-book authoring surface. PUBLISHER + ADMIN only;
// SUBSCRIBER (or anyone unauthenticated) is server-side-redirected away.
// This redirect is the load-bearing route guard; the nav-filter in
// <DashShell> is UI-affordance only.
//
// bkstr redesign PR 6 — migrated to <DashShell> + design-token header.
export default async function NewBookPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  if (session.user.role !== Role.PUBLISHER && session.user.role !== Role.ADMIN) {
    // Scenario D — SUBSCRIBER hits /dashboard/books/new directly, gets kicked.
    redirect("/dashboard");
  }

  const subscriber = await prisma.subscriber.findFirst({
    where: { user: { email: session.user.email } },
    select: { companyName: true },
  });
  const companyName = subscriber?.companyName ?? "Personal";
  const userEmail = session.user.email;

  return (
    <DashShell
      nav={buildDashNav(session.user.role, "/dashboard/books/new")}
      brandSubtitle={companyName.toUpperCase()}
      userBlock={<UserBlock email={userEmail} />}
    >
      <header className="mb-8">
        <Eyebrow>§ PUBLISH · ADD A VOLUME TO THE CATALOG</Eyebrow>
        <h1 className="font-serif font-normal text-[36px] leading-[1.05] tracking-display text-ink mt-3 mb-2">
          New Book
        </h1>
        <p className="text-ink-3 text-sm max-w-[72ch]">
          Publish a new book to the bkstr marketplace. Submitting creates a
          Stripe Product and Price, inserts the book + first version + USD
          price locally, and grants you authoring access. You can edit
          pricing later from the Pricing tab.
        </p>
      </header>

      <NewBookForm />
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
