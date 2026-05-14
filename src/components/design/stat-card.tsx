// bkstr redesign — StatCard primitive (HANDOFF.md §Cards + reference
// styles.css §.stat lines 477-486).
//
// Editorial frame, no rounded corners, no shadow. Mono eyebrow label up
// top, large serif value, optional mono delta line, optional inline
// sparkline below.

import type { ReactNode } from 'react';
import { Eyebrow } from './eyebrow';

export type StatCardProps = {
  /** Eyebrow label — e.g. "Total Fetches", "Volumes Owned". */
  label: ReactNode;
  /** Primary numeric or short text. Rendered serif, ~32px. */
  value: ReactNode;
  /** Optional change indicator — "+2,140" / "-3%". Pass `deltaDirection`
   * to color it; defaults to neutral ink-3 if omitted. */
  delta?: ReactNode;
  /** Color the delta — `up` = ok-green, `down` = err-rust, undefined = ink-3. */
  deltaDirection?: 'up' | 'down';
  /** Optional sparkline rendered below the delta — pass a numeric series.
   * The component renders a simple inline SVG path; no chart library. */
  spark?: number[];
  /** Sparkline color override; defaults to ink. */
  sparkColor?: string;
  className?: string;
};

const DELTA_COLOR = {
  up: 'text-status-ok',
  down: 'text-status-err',
} as const;

export function StatCard({
  label,
  value,
  delta,
  deltaDirection,
  spark,
  sparkColor,
  className = '',
}: StatCardProps) {
  return (
    <div
      className={[
        'bg-paper border border-rule p-5',
        // No rounded corners, no shadow — editorial frame per HANDOFF.md.
        className,
      ].join(' ').trim()}
    >
      <Eyebrow>{label}</Eyebrow>
      <div className="font-serif text-[32px] leading-none tracking-display text-ink mt-3 num">
        {value}
      </div>
      {delta ? (
        <div
          className={[
            'font-mono text-[11px] mt-2',
            deltaDirection ? DELTA_COLOR[deltaDirection] : 'text-ink-3',
          ].join(' ')}
        >
          {delta}
        </div>
      ) : null}
      {spark && spark.length > 1 ? (
        <div className="mt-3">
          <SparkLine data={spark} color={sparkColor ?? 'currentColor'} />
        </div>
      ) : null}
    </div>
  );
}

/** Inline sparkline — small SVG path, no chart library. Mirrors the
 * `<Spark>` in reference data.jsx:452-466. Width is 120px nominal but
 * the SVG scales to its container's font-size + viewBox. */
function SparkLine({
  data,
  color,
  width = 120,
  height = 28,
}: {
  data: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const pts = data
    .map((d, i) => `${i * stepX},${height - ((d - min) / range) * (height - 4) - 2}`)
    .join(' L ');
  const path = `M ${pts}`;
  const lastX = (data.length - 1) * stepX;
  const lastY =
    height - ((data[data.length - 1] - min) / range) * (height - 4) - 2;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      style={{ color }}
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r="2" fill="currentColor" />
    </svg>
  );
}
