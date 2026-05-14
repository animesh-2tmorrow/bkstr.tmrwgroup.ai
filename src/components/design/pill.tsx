// bkstr redesign — Pill primitive (HANDOFF.md §Component conventions / Pills).
//
// Mono uppercase label, 999px-only rounded (the one exception to the
// "no rounded corners" rule). Three variant groups:
//   - status — solid-ish status colors (ok/warn/err/info) with ~8% bg.
//   - accent — outline-only, accent color text + ~35% alpha border
//     (saffron/forest/oxblood/indigo/plum/slate).
//   - neutral / solid — plain (ink-2 on transparent) or solid (ink bg).
//
// Variant names are deliberate string literals — they match HANDOFF.md
// and `.pill-*` CSS classes in the reference's styles.css, so future
// engineers can grep the design system.

import type { ReactNode } from 'react';

export type PillVariant =
  | 'status-ok'
  | 'status-warn'
  | 'status-err'
  | 'status-info'
  | 'saffron'
  | 'forest'
  | 'oxblood'
  | 'indigo'
  | 'plum'
  | 'slate'
  | 'neutral'
  | 'solid';

// Per-variant class strings. Status pills have a subtle tinted background
// (~8% alpha); accent pills are outline-only. The hex values match the
// CSS custom properties in globals.css; we don't pull them as Tailwind
// `bg-status-ok/[0.08]` because Tailwind's arbitrary-alpha syntax doesn't
// play nicely with the named-color tokens we registered.
const VARIANTS: Record<PillVariant, string> = {
  'status-ok':   'text-status-ok   border-status-ok/40   bg-status-ok/10',
  'status-warn': 'text-status-warn border-status-warn/40 bg-status-warn/10',
  'status-err':  'text-status-err  border-status-err/40  bg-status-err/10',
  'status-info': 'text-status-info border-status-info/40 bg-status-info/10',
  saffron:       'text-saffron border-saffron/40',
  forest:        'text-forest  border-forest/40',
  oxblood:       'text-oxblood border-oxblood/40',
  indigo:        'text-indigo  border-indigo/40',
  plum:          'text-plum    border-plum/40',
  slate:         'text-slate   border-slate/40',
  neutral:       'text-ink-2 border-rule',
  solid:         'text-paper bg-ink border-ink',
};

export function Pill({
  variant = 'neutral',
  children,
  className = '',
}: {
  variant?: PillVariant;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full border',
        'px-2.5 py-0.5',
        'font-mono text-[10.5px] uppercase tracking-[0.08em]',
        VARIANTS[variant],
        className,
      ].join(' ').trim()}
    >
      {children}
    </span>
  );
}
