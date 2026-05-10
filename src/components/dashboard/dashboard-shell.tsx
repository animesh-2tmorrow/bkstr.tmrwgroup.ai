import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutLink } from "@/components/auth/sign-out-link";

export type DashboardNavKey =
  | "books"
  | "api-keys"
  | "fetch-logs"
  | "pricing"
  | "billing";

type Props = {
  active: DashboardNavKey;
  companyName: string;
  userEmail: string;
  initial: string;
  // Phase 3 Stream 3 — role is optional; pages that don't fetch it (older
  // pre-Stream-3 surfaces) still render. ADMIN gets the Pricing link.
  role?: string;
  children: ReactNode;
};

const NAV_ITEMS: ReadonlyArray<{
  key: DashboardNavKey;
  href: string;
  label: string;
  adminOnly?: boolean;
}> = [
  { key: "books", href: "/dashboard", label: "Active Books" },
  { key: "api-keys", href: "/dashboard/api-keys", label: "API Keys" },
  { key: "fetch-logs", href: "/dashboard/fetch-logs", label: "Fetch Logs" },
  { key: "pricing", href: "/dashboard/pricing", label: "Pricing", adminOnly: true },
  { key: "billing", href: "/dashboard/billing", label: "Billing" },
];

export function DashboardShell({ active, companyName, userEmail, initial, role, children }: Props) {
  const visibleItems = NAV_ITEMS.filter((item) => !item.adminOnly || role === "ADMIN");
  return (
    <div className="min-h-screen flex">
      <aside className="w-64 bg-[#FAF6EC] border-r border-[#E5DCC8] flex flex-col">
        <div className="p-6 border-b border-[#E5DCC8]">
          <div className="text-2xl font-bold serif italic">bkstr</div>
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
      </aside>

      <main className="flex-grow p-8 max-w-6xl">{children}</main>
    </div>
  );
}
