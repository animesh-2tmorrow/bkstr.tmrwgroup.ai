import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashShell, Eyebrow } from "@/components/design";
import { buildDashNav } from "@/lib/dashboard/nav-config";
import { filterByRole } from "@/lib/docs/filter-by-role";
import type { Role } from "@/generated/prisma/client";
import { getAllDocs, getDoc, canView } from "../_lib/docs";
import { DocsArticle } from "../_components/DocsArticle";
import { DocsNav } from "../_components/DocsNav";
import { DocsUserBlock } from "../_components/DocsUserBlock";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const doc = await getDoc(slug);
  return { title: doc ? `${doc.title} | bkstr docs` : "Docs | bkstr" };
}

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const role = (session.user.role ?? "SUBSCRIBER") as Role;
  const userEmail = session.user.email;

  const doc = await getDoc(slug);
  // Page-level role-gate: a gated page is a 404 for a role that can't see it,
  // exactly as if the file did not exist.
  if (!doc || !canView(doc, role)) notFound();

  const subscriber = await prisma.subscriber.findFirst({
    where: { user: { email: userEmail } },
    select: { companyName: true },
  });
  const companyName = subscriber?.companyName ?? "Personal";

  const docs = await getAllDocs();
  // filterByRole handles any inline :::role fences a page might use; most
  // single-track pages use none, in which case the body is returned as-is.
  const body = filterByRole(doc.body, role);

  return (
    <DashShell
      nav={buildDashNav(role, "/dashboard/docs")}
      brandSubtitle={companyName.toUpperCase()}
      userBlock={<DocsUserBlock email={userEmail} />}
    >
      <div className="grid grid-cols-1 lg:grid-cols-[196px_1fr] gap-10">
        <aside className="hidden lg:block">
          <Link
            href="/dashboard/docs"
            className="font-mono text-[11px] tracking-[1.5px] text-ink-3 uppercase hover:text-ink block mb-5"
          >
            ← All docs
          </Link>
          <DocsNav docs={docs} role={role} current={slug} />
        </aside>

        <main className="min-w-0">
          <header className="mb-6">
            <Eyebrow>§ DOCS</Eyebrow>
            <h1 className="font-serif font-normal text-[34px] leading-[1.08] tracking-display text-ink mt-3">
              {doc.title}
            </h1>
          </header>
          <DocsArticle body={body} />
        </main>
      </div>
    </DashShell>
  );
}
