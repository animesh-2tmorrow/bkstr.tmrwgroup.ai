// bkstr redesign — Masthead primitive (HANDOFF.md page-by-page §marketing,
// reference marketing.jsx + styles.css §masthead lines 169-223).
//
// Top-of-page chrome for marketing surfaces: thin mono compression-strip
// bar at the very top, then the primary nav with serif italic brand-mark
// and underline-on-active links.
//
// Used by `/` (landing), `/storefront` (catalog), `/login`, `/signup`
// (where appropriate — auth pages may omit the upper strip).
//
// Renders children inside the page after the nav — so this is the page
// shell, not just the header bar.

import type { ReactNode } from 'react';
import Link from 'next/link';

export type MastheadNavItem = {
  label: string;
  href: string;
  active?: boolean;
};

export type MastheadProps = {
  /** Primary nav links — typically Catalog / Skills / Docs / Sign in. */
  navItems: MastheadNavItem[];
  /** Right-side CTA — e.g. Sign in button. Renders after navItems. */
  rightSlot?: ReactNode;
  /** Top compression strip — mono uppercase text. Optional; many pages
   *  use it for editorial tagline / date stamp / "Editorial Imprint × …". */
  topStrip?: ReactNode;
  /** Page content rendered below the masthead. */
  children?: ReactNode;
};

export function Masthead({
  navItems,
  rightSlot,
  topStrip,
  children,
}: MastheadProps) {
  return (
    <>
      {topStrip ? (
        <div className="border-b border-rule py-3.5 font-mono text-[11px] uppercase tracking-eyebrow text-ink-3">
          <div className="max-w-[1280px] mx-auto px-8 flex items-center justify-between gap-4">
            {topStrip}
          </div>
        </div>
      ) : null}

      <header className="border-b-2 border-ink py-[18px] bg-paper">
        <div className="max-w-[1280px] mx-auto px-8 flex items-center justify-between gap-6">
          <Link
            href="/"
            className="font-serif italic text-[32px] leading-none tracking-display text-ink inline-flex items-baseline gap-2"
          >
            <span>bkstr</span>
            <span className="font-mono not-italic text-[10px] tracking-eyebrow uppercase text-ink-3">
              tmrwgroup.ai
            </span>
          </Link>
          <nav className="flex items-center gap-6">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  'relative text-sm py-1 transition-colors',
                  item.active
                    ? 'text-ink after:content-[""] after:absolute after:left-0 after:right-0 after:-bottom-[22px] after:h-0.5 after:bg-ink'
                    : 'text-ink-2 hover:text-ink',
                ].join(' ')}
              >
                {item.label}
              </Link>
            ))}
            {rightSlot}
          </nav>
        </div>
      </header>

      {children}
    </>
  );
}
