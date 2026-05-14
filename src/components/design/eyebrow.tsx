// bkstr redesign — Eyebrow primitive (HANDOFF.md §Typography "Eyebrow labels").
//
// Mono, 11px, uppercase, tracking 0.14em, ink-3. Used as the small label
// above section titles, in section dividers, on stat cards, and as group
// headers in the dashboard sidebar.

import type { ElementType, ReactNode } from 'react';

export function Eyebrow({
  children,
  className = '',
  as: Tag = 'span',
}: {
  children: ReactNode;
  className?: string;
  /** Render as a different element (e.g. `div` for block context).
   *  Typed as `ElementType` rather than `keyof JSX.IntrinsicElements`
   *  because the global JSX namespace isn't available under
   *  @types/react v19. ElementType covers both intrinsic tags and
   *  React components, which is the right surface anyway. */
  as?: ElementType;
}) {
  return (
    // The `eyebrow` utility class lives in globals.css — single source for
    // font + size + tracking + color. className extends but doesn't replace.
    <Tag className={`eyebrow ${className}`.trim()}>{children}</Tag>
  );
}
