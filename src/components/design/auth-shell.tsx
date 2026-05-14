// bkstr redesign — AuthShell primitive (HANDOFF.md page-by-page §auth,
// reference auth.jsx:8-31).
//
// Two-column 1fr / 1fr layout for /login and /signup. Left column is
// paper-2 with the brand mark top-left, editorial slot in the middle,
// version eyebrows at the bottom-right corner. Right column is paper
// with the form centered in a 420px max-width column.
//
// Full viewport height; stacks single-column at < md so the form is
// always reachable on narrow screens (sidebar content moves above).
//
// The `side` slot is whatever editorial content fits — pull-quote +
// mini covers (login), marketing pitch + stat grid (signup), etc.
// The shell stays presentational.

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Eyebrow } from './eyebrow';

export function AuthShell({
  side,
  children,
}: {
  /** Left-column editorial content. Rendered inside a centered 480px
   *  max-width block, vertically centered between brand mark and the
   *  bottom version-eyebrow strip. */
  side: ReactNode;
  /** Right-column content. Centered in a 420px max-width block,
   *  vertically centered in the column. */
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-2 bg-paper">
      {/* LEFT — paper-2, editorial */}
      <aside className="bg-paper-2 md:border-r border-rule px-8 md:px-14 py-10 flex flex-col justify-between min-h-[60vh] md:min-h-screen">
        <Link
          href="/"
          className="self-start font-serif italic text-[26px] leading-none text-ink inline-flex items-baseline gap-2"
        >
          <span>bkstr</span>
          <span className="font-mono not-italic text-[10px] tracking-eyebrow uppercase text-ink-3">
            AN IMPRINT OF TMRW GROUP
          </span>
        </Link>

        <div className="max-w-[480px] my-10 md:my-0">{side}</div>

        <div className="flex justify-between text-ink-3">
          <Eyebrow>VOL. 01 · ISS. 03</Eyebrow>
          <Eyebrow>EST. 2026</Eyebrow>
        </div>
      </aside>

      {/* RIGHT — paper, form */}
      <main className="px-8 md:px-14 py-10 flex flex-col justify-center min-h-[60vh] md:min-h-screen">
        <div className="max-w-[420px] w-full mx-auto">{children}</div>
      </main>
    </div>
  );
}
