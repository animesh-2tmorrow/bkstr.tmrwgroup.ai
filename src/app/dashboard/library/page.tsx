import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashShell, Eyebrow } from "@/components/design";
import { LibraryTable, type LibraryFilter } from "@/components/dashboard/library-table";
import {
  getCatalogForLibrary,
  getAccessStatesForCatalog,
} from "@/lib/dashboard/queries";
import { buildDashNav } from "@/lib/dashboard/nav-config";

// bkstr redesign PR 3 — Library on the new <DashShell>.
//
// Filter state still URL-driven (?filter=active|browse|all) per Stream C
// — the view is link-shareable and refresh-stable. No client useState.
//
// redesign(10)/3 — switched data source from getBooksForLibrary +
// getBookAccessStates to the kind-aware getCatalogForLibrary +
// getAccessStatesForCatalog (Phase 1 additions). Library now shows
// books + skills together, accessByItem keyed `${kind}:${id}`.

export const metadata = { title: "Library | bkstr" };
export const dynamic = "force-dynamic";

function parseFilter(raw: string | string[] | undefined): LibraryFilter {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "active" || v === "browse" || v === "all") return v;
  return "all";
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const params = await searchParams;
  const filter = parseFilter(params.filter);

  const subscriber = await prisma.subscriber.findFirst({
    where: { user: { email: session.user.email } },
    select: { id: true, companyName: true },
  });
  const companyName = subscriber?.companyName ?? "Personal";
  const userEmail = session.user.email;

  const [items, accessByItem] = await Promise.all([
    getCatalogForLibrary(),
    subscriber ? getAccessStatesForCatalog(subscriber.id) : Promise.resolve(undefined),
  ]);

  return (
    <DashShell
      nav={buildDashNav(session.user.role, "/dashboard/library")}
      brandSubtitle={companyName.toUpperCase()}
      userBlock={<UserBlock email={userEmail} />}
    >
      <div className="flex justify-between items-end gap-6 mb-8">
        <div>
          <Eyebrow>§ LBRRY · BROWSE, BUY, OR FETCH</Eyebrow>
          <h1 className="font-serif font-normal text-[36px] leading-[1.05] tracking-display text-ink mt-3 mb-2">
            Library
          </h1>
          <p className="text-ink-3 text-sm max-w-[60ch]">
            Browse the catalog, buy a one-time purchase to add a volume to
            your fleet, or pull up an API-access curl for anything you
            already own. Once you own it, your agents fetch it via your
            API key — books for grounded Q&A, skills for install-and-run.
          </p>
        </div>
        <a
          href="/storefront"
          className="inline-flex items-center justify-center px-3 py-1.5 text-xs font-medium font-sans bg-transparent text-ink border border-ink hover:bg-ink hover:text-paper transition-colors rounded-none"
        >
          Public storefront ↗
        </a>
      </div>

      <LibraryTable
        subscriberId={subscriber?.id ?? null}
        items={items}
        accessByItem={accessByItem}
        filter={filter}
      />
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
