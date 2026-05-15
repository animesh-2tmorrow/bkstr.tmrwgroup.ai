import { promises as fs } from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashShell, Eyebrow } from "@/components/design";
import { filterByRole } from "@/lib/docs/filter-by-role";
import type { Role } from "@/generated/prisma/client";
import { buildDashNav } from "@/lib/dashboard/nav-config";

export const metadata = {
  title: "Docs | bkstr",
};

// Phase 5 Stream A (D13.1) — force-dynamic so role-filtering runs at request
// time, not build time. The markdown file is read each request via fs.
//
// bkstr redesign PR 7 — migrated to <DashShell> + design-token header.
// React-markdown emits semantic HTML (<h1>, <p>, <ul>, ...) into a plain
// <article> wrapper; @tailwindcss/typography is not installed so we don't
// use `prose`. Editorial styling falls out of Tailwind preflight + the
// global font stack (Newsreader for body via design tokens).
export const dynamic = "force-dynamic";

const DOCS_PATH = path.join(process.cwd(), "src/content/docs/index.md");

export default async function DocsPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const role = (session.user.role ?? "SUBSCRIBER") as Role;
  const userEmail = session.user.email;

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
    <DashShell
      nav={buildDashNav(role, "/dashboard/docs")}
      brandSubtitle={companyName.toUpperCase()}
      userBlock={<UserBlock email={userEmail} />}
    >
      <header className="mb-8">
        <Eyebrow>§ REF · OPERATOR DOCUMENTATION</Eyebrow>
        <h1 className="font-serif font-normal text-[36px] leading-[1.05] tracking-display text-ink mt-3 mb-2">
          Docs
        </h1>
        <p className="text-ink-3 text-sm max-w-[72ch]">
          API contracts, runbooks, and platform notes scoped to your role
          ({role.toLowerCase()}). Sections marked with role gates only
          appear for the operators who need them.
        </p>
      </header>

      <article className="max-w-3xl space-y-4 text-ink-2 leading-[1.65] [&_h1]:font-serif [&_h1]:text-[28px] [&_h1]:tracking-display [&_h1]:text-ink [&_h1]:mt-8 [&_h2]:font-serif [&_h2]:text-[22px] [&_h2]:tracking-display [&_h2]:text-ink [&_h2]:mt-6 [&_h3]:font-serif [&_h3]:text-[18px] [&_h3]:text-ink [&_h3]:mt-4 [&_code]:font-mono [&_code]:text-[13px] [&_code]:bg-paper-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:border [&_code]:border-rule [&_pre]:bg-paper-2 [&_pre]:border [&_pre]:border-rule [&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre]:font-mono [&_pre]:text-[12px] [&_pre>code]:bg-transparent [&_pre>code]:border-0 [&_pre>code]:p-0 [&_a]:text-ink [&_a]:underline hover:[&_a]:no-underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{filtered}</ReactMarkdown>
      </article>
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
