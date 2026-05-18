import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashShell, Eyebrow } from "@/components/design";
import { buildDashNav } from "@/lib/dashboard/nav-config";
import type { Role } from "@/generated/prisma/client";
import { getAllDocs, groupByTrack, TRACK_LABEL } from "./_lib/docs";
import { DocsUserBlock } from "./_components/DocsUserBlock";

export const metadata = {
  title: "Docs | bkstr",
};

// force-dynamic so the role-gate runs per request (a role change propagates
// without a redeploy). Markdown is read from src/content/docs/ each request.
export const dynamic = "force-dynamic";

export default async function DocsHubPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const role = (session.user.role ?? "SUBSCRIBER") as Role;
  const userEmail = session.user.email;

  const subscriber = await prisma.subscriber.findFirst({
    where: { user: { email: userEmail } },
    select: { companyName: true },
  });
  const companyName = subscriber?.companyName ?? "Personal";

  const docs = await getAllDocs();
  const groups = groupByTrack(docs, role);

  return (
    <DashShell
      nav={buildDashNav(role, "/dashboard/docs")}
      brandSubtitle={companyName.toUpperCase()}
      userBlock={<DocsUserBlock email={userEmail} />}
    >
      <header className="mb-8">
        <Eyebrow>§ REF · BKSTR DOCUMENTATION</Eyebrow>
        <h1 className="font-serif font-normal text-[36px] leading-[1.05] tracking-display text-ink mt-3 mb-2">
          Docs
        </h1>
        <p className="text-ink-3 text-sm max-w-[72ch]">
          Guides and reference for bkstr — buying and installing books and
          skills, the CLI and API, and, for publishers, authoring and pricing.
          Pages are scoped to your role ({role.toLowerCase()}).
        </p>
      </header>

      <div className="max-w-3xl space-y-10">
        {groups.map((group) => (
          <section key={group.track}>
            <h2 className="font-serif text-[22px] tracking-display text-ink mb-3">
              {TRACK_LABEL[group.track]}
            </h2>
            <div className="border-t border-rule">
              {group.pages.map((page) => (
                <Link
                  key={page.slug}
                  href={`/dashboard/docs/${page.slug}`}
                  className="group block border-b border-rule py-3"
                >
                  <div className="text-ink group-hover:underline">
                    {page.title}
                  </div>
                  {page.summary ? (
                    <div className="text-ink-3 text-sm mt-0.5">
                      {page.summary}
                    </div>
                  ) : null}
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </DashShell>
  );
}
