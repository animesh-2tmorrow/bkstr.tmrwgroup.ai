// bkstr redesign — DashShell primitive (HANDOFF.md page-by-page §app,
// reference dashboard.jsx + styles.css §dash lines 393-471).
//
// App-surface shell: 248px fixed-width sidebar + flexible main content.
// Both surfaces use the cream palette (HANDOFF.md is explicit: "Both
// share one color palette" — the `data-theme="dark"` overrides in the
// reference styles.css are deliberately re-remapped to cream-on-cream).
//
// This is a NEW shell that lives alongside the existing
// src/components/dashboard/dashboard-shell.tsx. Dashboard pages migrate
// to this one in PR 3+. Until then, the existing shell stays on prod.
//
// Sidebar items are passed in by the caller (lets each page declare its
// own active state). The shell itself renders the brand, the sidebar
// frame, the active-rail styling, and the main content area.

import type { ReactNode } from 'react';
import Link from 'next/link';

export type DashNavItem = {
  /** Display label. */
  label: string;
  /** Destination URL. */
  href: string;
  /** Active flag — the caller decides which item is current. */
  active?: boolean;
  /** Optional inline SVG icon — kept as a `ReactNode` so callers can use
   *  whatever icon source they like (HANDOFF.md: "inline SVG only"). */
  icon?: ReactNode;
};

export type DashNavGroup = {
  /** Eyebrow label rendered above this group. Optional. */
  label?: string;
  items: DashNavItem[];
};

export type DashShellProps = {
  /** Nav groups rendered in order. The first group typically has no
   *  label (the primary section); subsequent groups separate admin,
   *  publisher, etc. */
  nav: DashNavGroup[];
  /** Brand subtitle below "bkstr" — e.g. the user's company name. */
  brandSubtitle?: string;
  /** Bottom user-info block — rendered below the nav, separated by a
   *  rule. Pass user email + sign-out, etc. */
  userBlock?: ReactNode;
  /** Page content rendered in the main area to the right of the sidebar. */
  children?: ReactNode;
};

export function DashShell({
  nav,
  brandSubtitle,
  userBlock,
  children,
}: DashShellProps) {
  return (
    <div className="grid grid-cols-[248px_1fr] min-h-screen bg-paper-2">
      <aside className="bg-paper border-r border-rule flex flex-col sticky top-0 max-h-screen overflow-y-auto overflow-x-hidden py-6">
        {/* Brand block */}
        <div className="px-5 pb-5 border-b border-rule mb-3">
          <div className="font-serif italic text-[26px] leading-none text-ink">
            bkstr
          </div>
          {brandSubtitle ? (
            <div className="font-mono text-[10px] tracking-eyebrow uppercase text-ink-4 mt-1.5">
              {brandSubtitle}
            </div>
          ) : null}
        </div>

        {/* Nav groups */}
        <nav className="flex flex-col flex-1 px-3 gap-px">
          {nav.map((group, gi) => (
            <div key={gi} className="flex flex-col">
              {group.label ? (
                <div className="font-mono text-[10px] tracking-eyebrow uppercase text-ink-4 px-3 pt-4 pb-2">
                  {group.label}
                </div>
              ) : null}
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={[
                    'flex items-center gap-2.5 px-3 py-2 text-[13.5px]',
                    'border-l-2 -ml-0.5',
                    'transition-[background-color,color,border-color] duration-100',
                    item.active
                      ? 'bg-paper-2 text-ink border-saffron-dk'
                      : 'text-ink-2 border-transparent hover:bg-paper-2 hover:text-ink',
                  ].join(' ')}
                >
                  {item.icon ? (
                    <span
                      aria-hidden
                      className={[
                        'inline-flex',
                        item.active ? 'text-saffron-dk' : 'text-ink-3',
                      ].join(' ')}
                    >
                      {item.icon}
                    </span>
                  ) : null}
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>

        {userBlock ? (
          <div className="px-5 pt-4 pb-2 border-t border-rule text-xs text-ink-3">
            {userBlock}
          </div>
        ) : null}
      </aside>

      <main className="p-8 lg:p-12 bg-paper-2 min-w-0">{children}</main>
    </div>
  );
}
