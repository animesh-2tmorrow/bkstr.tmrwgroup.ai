// bkstr redesign — SectionRule primitive (HANDOFF.md §Component conventions
// / Section dividers, styles.css §section-rule).
//
// Pattern: left eyebrow label + horizontal hairline (flex-1) + optional
// right label. Used to divide major sections on marketing pages (e.g.
// "§ ON THE SHELF" / "AS OF 2026-05-14"). The eyebrow label encodes the
// compression motif: "§ ON THE SHELF", "KNWLDGE FR YR FLEET", etc.

import { Eyebrow } from './eyebrow';

export function SectionRule({
  label,
  rightLabel,
  className = '',
}: {
  label: string;
  rightLabel?: string;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-4 my-12 ${className}`.trim()}>
      <Eyebrow className="tracking-section">{label}</Eyebrow>
      <span aria-hidden className="flex-1 h-px bg-ink" />
      {rightLabel ? (
        <Eyebrow className="tracking-section">{rightLabel}</Eyebrow>
      ) : null}
    </div>
  );
}
