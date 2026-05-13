import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutLink } from "@/components/auth/sign-out-link";

// Phase 4.5 Streams E + F — admin-* keys pre-declared together to minimize
// the rebase footprint when Stream F lands. Stream E ships "admin-users"; the
// "admin-books" + "admin-grants" keys exist here so the union type is stable
// once Stream F adds its leaves (each Stream's nav items will be added to
// NAV_ITEMS below independently — additive, no edit-collision). Trivial
// rebase either way.
export type DashboardNavKey =
  | "books"
  | "library"
  | "skills"
  | "api-keys"
  | "fetch-logs"
  | "pricing"
  | "new-book"
  | "billing"
  | "admin-users"
  | "admin-books"
  | "admin-grants"
  // Phase 5 Stream B (D14.1) — admin AI assistant. ADMIN-only; placed
  // adjacent to other admin-* keys to keep the union ordered by surface
  // role. Read-only against Prisma; never mutates.
  | "admin-assistant"
  // Phase 5 Stream A (D13.1) — in-product docs surface, visible to all
  // signed-in users (no role flag below). Placed last so it renders as the
  // bottom of the visible nav across SUBSCRIBER / PUBLISHER / ADMIN.
  | "docs";

type Props = {
  active: DashboardNavKey;
  companyName: string;
  userEmail: string;
  initial: string;
  // Phase 3 Stream 3 — role is optional; pages that don't fetch it (older
  // pre-Stream-3 surfaces) still render. Phase 4 Stream B — Pricing + New
  // Book are visible to both PUBLISHER and ADMIN (previously ADMIN-only).
  role?: string;
  children: ReactNode;
};

// Phase 4 Stream B — `publisherOrAdmin: true` gates a nav item to the union of
// PUBLISHER and ADMIN. The previous `adminOnly` flag for Pricing collapsed to
// this broader gate as part of the publisher-UI rollout. Server-side route
// guards inside /dashboard/pricing and /dashboard/books/new remain the
// load-bearing authz check; this filter is UI-affordance only.
//
// Phase 4.5 Streams E + F — `adminOnly: true` re-introduces a strict-ADMIN
// gate for /dashboard/admin/* surfaces (admin-users from Stream E;
// admin-books + admin-grants from Stream F). The shared layout at
// app/dashboard/admin/layout.tsx is the load-bearing redirect; this flag is
// UI-affordance only — hide the nav for SUBSCRIBER + PUBLISHER so they don't
// see dead links. Mirrors the publisherOrAdmin precedent.
const NAV_ITEMS: ReadonlyArray<{
  key: DashboardNavKey;
  href: string;
  label: string;
  publisherOrAdmin?: boolean;
  adminOnly?: boolean;
}> = [
  { key: "books", href: "/dashboard", label: "Active Books" },
  { key: "library", href: "/dashboard/library", label: "Library" },
  // Phase 6 Stream L follow-up — Skills sidebar entry. Points at the PUBLIC
  // /skills listing (no /dashboard/skills exists yet — that's the bigger
  // dashboard-parity follow-up). Clicking exits dashboard chrome and lands
  // on the storefront layout; user navigates back via the bkstr logo or
  // browser back. Visible to all roles (mirrors Library).
  { key: "skills", href: "/skills", label: "Skills" },
  { key: "api-keys", href: "/dashboard/api-keys", label: "API Keys" },
  { key: "fetch-logs", href: "/dashboard/fetch-logs", label: "Fetch Logs" },
  { key: "pricing", href: "/dashboard/pricing", label: "Pricing", publisherOrAdmin: true },
  { key: "new-book", href: "/dashboard/books/new", label: "New Book", publisherOrAdmin: true },
  { key: "billing", href: "/dashboard/billing", label: "Billing" },
  // Phase 4.5 admin surfaces (Streams E + F). Order: users → books → grants
  // so the workflow flows "manage who" → "manage what" → "manage access."
  { key: "admin-users", href: "/dashboard/admin/users", label: "Admin · Users", adminOnly: true },
  { key: "admin-books", href: "/dashboard/admin/books", label: "Admin · Books", adminOnly: true },
  { key: "admin-grants", href: "/dashboard/admin/grants", label: "Admin · Grants", adminOnly: true },
  // Phase 5 Stream B (D14.1) — admin AI assistant. Placed after grants so
  // the admin workflow reads "manage who / what / access / ask questions."
  { key: "admin-assistant", href: "/dashboard/admin/assistant", label: "Admin · Assistant", adminOnly: true },
  // Phase 5 Stream A (D13.1) — Docs is visible to all signed-in users (no
  // role flag). Last entry so it renders at the bottom of the real nav for
  // every role; per-section role filtering happens inside the page (D13.2).
  { key: "docs", href: "/dashboard/docs", label: "Docs" },
];

export function DashboardShell({ active, companyName, userEmail, initial, role, children }: Props) {
  // Phase 4 Stream B — PUBLISHER + ADMIN see authoring nav (Pricing, New Book);
  // SUBSCRIBER does not.
  // Phase 4.5 Streams E + F — `adminOnly` gates a nav item to ADMIN only;
  // PUBLISHER does NOT see admin surfaces. Three-tier gating: items with
  // neither flag are visible to all roles; items with `publisherOrAdmin` are
  // visible to PUBLISHER + ADMIN; items with `adminOnly` are visible to ADMIN
  // only.
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.adminOnly) return role === "ADMIN";
    if (item.publisherOrAdmin) return role === "ADMIN" || role === "PUBLISHER";
    return true;
  });
  return (
    <div className="min-h-screen flex">
      <aside className="w-64 bg-[#FAF6EC] border-r border-[#E5DCC8] flex flex-col">
        <div className="p-6 border-b border-[#E5DCC8]">
          {/* Phase 5 Stream C / D14.7 — TMRW Group icon mark left of the
              wordmark. alt="" because the adjacent "bkstr" text is the
              accessible label; the icon is decorative. `priority` because the
              sidebar header is above-the-fold on every dashboard page. */}
          <div className="flex items-center gap-2">
            <Image src="/logo-icon.png" alt="" width={28} height={36} priority />
            <div className="text-2xl font-bold serif italic">bkstr</div>
          </div>
          <div className="text-xs font-semibold text-gray-500 mt-1 uppercase tracking-wider">
            {companyName}
          </div>
        </div>
        <nav className="flex-grow p-4 space-y-1 text-sm font-medium text-gray-600">
          {visibleItems.map((item) => {
            const isActive = item.key === active;
            const className = isActive
              ? "block px-4 py-2.5 rounded-lg nav-item active"
              : "block px-4 py-2.5 rounded-lg hover:bg-[#EAE2D0] hover:text-gray-900";
            return (
              <Link key={item.key} href={item.href} className={className}>
                {item.label}
              </Link>
            );
          })}
          <a href="#" className="block px-4 py-2.5 rounded-lg hover:bg-[#EAE2D0] hover:text-gray-900">
            Usage Metrics
          </a>
          <a href="#" className="block px-4 py-2.5 rounded-lg hover:bg-[#EAE2D0] hover:text-gray-900">
            Team Access
          </a>
        </nav>
        <div className="p-6 border-t border-[#E5DCC8]">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-full bg-[#EAE2D0] flex items-center justify-center text-xs font-bold text-gray-600">
              {initial}
            </div>
            <div className="text-sm font-medium truncate">{userEmail}</div>
          </div>
          <SignOutLink />
        </div>
        {/* Phase 5 Stream C / D14.7 — TMRW Group platform attribution.
            Separated from the user-info block above by border-t; the semantic
            split is "your account" vs "platform attribution." px-6 py-4 (less
            padding than the p-6 user-info block) reads as compact footer
            rather than primary content. */}
        <div className="px-6 py-4 border-t border-[#E5DCC8] flex flex-col items-start gap-1">
          <span className="text-[10px] uppercase tracking-wider text-gray-500">A product by</span>
          <Image src="/logo-full.png" alt="TMRW Group" width={60} height={80} />
        </div>
      </aside>

      <main className="flex-grow p-8 max-w-6xl">{children}</main>
    </div>
  );
}
