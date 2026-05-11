import { promises as fs } from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { filterByRole } from "@/lib/docs/filter-by-role";
import type { Role } from "@/generated/prisma/client";

export const metadata = {
  title: "Docs | bkstr",
};

// Phase 5 Stream A (D13.1) — force-dynamic so role-filtering runs at request
// time, not build time. The markdown file is read each request via fs.
export const dynamic = "force-dynamic";

const DOCS_PATH = path.join(process.cwd(), "src/content/docs/index.md");

export default async function DocsPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const role = (session.user.role ?? "SUBSCRIBER") as Role;
  const userEmail = session.user.email;
  const initial = (session.user.name?.[0] ?? userEmail[0] ?? "?").toUpperCase();

  // Subscriber-row lookup mirrors the other dashboard pages (consistent shell
  // decoration). No data dep here, just shell metadata.
  const subscriber = await prisma.subscriber.findFirst({
    where: { user: { email: userEmail } },
    select: { companyName: true },
  });
  const companyName = subscriber?.companyName ?? "Personal";

  const raw = await fs.readFile(DOCS_PATH, "utf8");
  const filtered = filterByRole(raw, role);

  return (
    <DashboardShell
      active="docs"
      companyName={companyName}
      userEmail={userEmail}
      initial={initial}
      role={role}
    >
      {/* Phase 5 Stream A (D13.1) — tailwind.config.ts does NOT include
          @tailwindcss/typography, so the `prose` class would be unstyled.
          Falling back to a plain wrapper. React-markdown emits semantic HTML
          (<h1>, <p>, <ul>, ...) which Tailwind's preflight + the base font
          stack render readably; space-y-4 gives vertical rhythm between
          block-level children. If the typography plugin is added later, swap
          this for `prose prose-sm max-w-3xl`. */}
      <article className="max-w-3xl space-y-4">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{filtered}</ReactMarkdown>
      </article>
    </DashboardShell>
  );
}
