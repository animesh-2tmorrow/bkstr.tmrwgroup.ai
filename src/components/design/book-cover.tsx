// bkstr redesign — BookCover primitive (HANDOFF.md §Component conventions /
// Book cover, reference data.jsx:327-449).
//
// Procedurally-generated typographic SVG. Five zones (HANDOFF.md):
//   1. Top imprint bar — "BKSTR — DOMAIN" left / "VOL X" right (mono).
//   2. Large italic single-letter glyph (the title's first letter).
//   3. Title block — display serif, 2-3 lines, ranged left.
//   4. Density bar — vertical ticks + "DENSITY — XX TOKENS / Y.YY×" (mono).
//   5. Bottom imprint — author left / version right (mono).
//
// IMPORTANT — production data model:
//   The columns `palette` and `glyph` on `books` are added in PR 8
//   (redesign/8-covers-data). For PR 0 the type is permissive; until
//   then, callers can pass a sentinel/derive locally. The component
//   itself is schema-agnostic — it takes a flat object.
//
// Photographic covers (`Book.coverImageUrl`) are NOT supported by this
// component — typography only, per HANDOFF.md "Imagery on books is
// forbidden — they are typographic objects." Migration off coverImageUrl
// lands in PR 8.

import type { CSSProperties } from 'react';

export type BookCoverPalette =
  | 'saffron'
  | 'forest'
  | 'oxblood'
  | 'indigo'
  | 'plum'
  | 'slate';

export type BookCoverSize = 'xs' | 'sm' | 'md' | 'lg' | 'hero';

export type BookCoverData = {
  /** Display title (gets word-wrapped to 2-3 lines on the cover). */
  title: string;
  /** Optional italic subtitle below the title block. */
  subtitle?: string | null;
  /** Single uppercase letter, the cover's typographic hero. */
  glyph: string;
  /** Domain tag, rendered uppercase in the top imprint bar. */
  domain: string;
  /** Volume label — e.g. "Vol. 03" (rendered as "VOL 03"). */
  vol: string;
  /** Version string — e.g. "v2.3" or "v1". */
  version: string;
  /** Author name — rendered uppercase in the bottom imprint bar. */
  author: string;
  /** Color palette key. Looked up in PALETTE_MAP below. */
  palette: BookCoverPalette;
  /** Token count, free-form label — e.g. "98.4k" or "62.1k". */
  tokens?: string;
  /** Compression label — e.g. "0.46×". */
  compression?: string;
  /** Chapter count — drives the density-bar tick heights (deterministic). */
  chapters?: number;
};

// Palette lookup — mirrors data.jsx:314-321 byte-for-byte. The `mark`
// color is the muted accent used for the large italic glyph.
const PALETTE_MAP: Record<
  BookCoverPalette,
  { bg: string; ink: string; mark: string }
> = {
  saffron: { bg: '#C46A1F', ink: '#FFF7E8', mark: '#FFD9A0' },
  forest:  { bg: '#1F3D2B', ink: '#E9F0E5', mark: '#A4C39A' },
  oxblood: { bg: '#6B2424', ink: '#F4E6E6', mark: '#D6A1A1' },
  indigo:  { bg: '#2A3D6B', ink: '#E6ECF7', mark: '#A0B5DC' },
  plum:    { bg: '#4B2A5C', ink: '#EFE5F5', mark: '#C8A8DA' },
  slate:   { bg: '#354455', ink: '#E7ECF2', mark: '#A3B4C5' },
};

const DIMS: Record<BookCoverSize, { w: number; h: number }> = {
  xs:   { w: 48,  h: 64 },
  sm:   { w: 120, h: 160 },
  md:   { w: 200, h: 280 },
  lg:   { w: 280, h: 380 },
  hero: { w: 360, h: 500 },
};

// SVG canvas dims (independent of render size — viewBox-scaled).
const CANVAS_W = 500;
const CANVAS_H = 700;

/** Wrap the title into 2-3 lines of ~14 chars each, ranged left. */
function wrapTitle(title: string): string[] {
  const words = title.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const candidate = (cur + ' ' + w).trim();
    if (candidate.length > 14 && cur) {
      lines.push(cur.trim());
      cur = w;
    } else {
      cur = candidate;
    }
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}

/** Deterministic tick-height sequence for the density bar. */
function densityTicks(chapters: number = 8): number[] {
  return Array.from({ length: 18 }, (_, i) => 4 + ((i * 7 + chapters * 3) % 14));
}

export function BookCover({
  book,
  size = 'md',
  flat = false,
  className = '',
  style,
}: {
  book: BookCoverData;
  size?: BookCoverSize;
  /** Suppress the shadow stack — for grid backgrounds where shadows clash. */
  flat?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const palette = PALETTE_MAP[book.palette] ?? PALETTE_MAP.indigo;
  const dims = DIMS[size];
  const lines = wrapTitle(book.title);
  const ticks = densityTicks(book.chapters ?? 8);

  // Shadow stack — three layered shadows match the reference exactly.
  // HANDOFF.md says "no drop shadows on cards" but covers are a special
  // case — they're objects, not surfaces. styles.css applies a shadow
  // stack via the SVG inline style; we mirror it.
  const shadow = flat
    ? 'none'
    : '0 1px 0 rgba(0,0,0,0.04), 0 14px 30px -18px rgba(0,0,0,0.45), 0 4px 8px -4px rgba(0,0,0,0.18)';

  const volLabel = book.vol.toUpperCase().replace('VOL. ', 'VOL ');
  const densityCaption =
    book.tokens && book.compression
      ? `DENSITY — ${book.tokens} TOKENS  /  ${book.compression}`
      : 'DENSITY';

  return (
    <svg
      viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
      width={dims.w}
      height={dims.h}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${book.title} cover`}
      className={className}
      style={{ display: 'block', boxShadow: shadow, ...style }}
    >
      {/* paper */}
      <rect x="0" y="0" width={CANVAS_W} height={CANVAS_H} fill={palette.bg} />

      {/* 1. top imprint bar */}
      <line
        x1="44"
        y1="56"
        x2={CANVAS_W - 44}
        y2="56"
        stroke={palette.ink}
        strokeOpacity="0.4"
        strokeWidth="1"
      />
      <text
        x="44"
        y="44"
        fill={palette.ink}
        fontFamily="JetBrains Mono, monospace"
        fontSize="14"
        letterSpacing="2"
      >
        {`BKSTR — ${book.domain.toUpperCase()}`}
      </text>
      <text
        x={CANVAS_W - 44}
        y="44"
        textAnchor="end"
        fill={palette.ink}
        fontFamily="JetBrains Mono, monospace"
        fontSize="14"
        letterSpacing="2"
      >
        {volLabel}
      </text>

      {/* 2. large italic glyph */}
      <text
        x={CANVAS_W / 2}
        y={290}
        textAnchor="middle"
        fill={palette.mark}
        fontFamily="Newsreader, Georgia, serif"
        fontSize="320"
        fontStyle="italic"
        opacity="0.85"
      >
        {book.glyph}
      </text>

      {/* 3. title block */}
      <g transform={`translate(44, ${360})`}>
        {lines.map((ln, i) => (
          <text
            key={i}
            x="0"
            y={i * 50}
            fill={palette.ink}
            fontFamily="Newsreader, Georgia, serif"
            fontSize="44"
            fontWeight="400"
            letterSpacing="-1"
          >
            {ln}
          </text>
        ))}
      </g>

      {/* subtitle (optional) */}
      {book.subtitle ? (
        <text
          x="44"
          y={360 + lines.length * 50 + 28}
          fill={palette.ink}
          fontFamily="Newsreader, Georgia, serif"
          fontStyle="italic"
          fontSize="20"
          opacity="0.85"
        >
          {book.subtitle}
        </text>
      ) : null}

      {/* 4. density bar */}
      <g transform={`translate(44, ${CANVAS_H - 130})`}>
        <text
          x="0"
          y="-12"
          fill={palette.ink}
          fontFamily="JetBrains Mono, monospace"
          fontSize="11"
          letterSpacing="1.5"
          opacity="0.7"
        >
          {densityCaption}
        </text>
        {ticks.map((t, i) => (
          <rect
            key={i}
            x={i * 13}
            y={20 - t}
            width="6"
            height={t}
            fill={palette.ink}
            opacity="0.85"
          />
        ))}
      </g>

      {/* 5. bottom imprint */}
      <line
        x1="44"
        y1={CANVAS_H - 70}
        x2={CANVAS_W - 44}
        y2={CANVAS_H - 70}
        stroke={palette.ink}
        strokeOpacity="0.4"
        strokeWidth="1"
      />
      <text
        x="44"
        y={CANVAS_H - 42}
        fill={palette.ink}
        fontFamily="JetBrains Mono, monospace"
        fontSize="14"
        letterSpacing="2"
      >
        {book.author.toUpperCase()}
      </text>
      <text
        x={CANVAS_W - 44}
        y={CANVAS_H - 42}
        textAnchor="end"
        fill={palette.ink}
        fontFamily="JetBrains Mono, monospace"
        fontSize="14"
        letterSpacing="2"
      >
        {book.version.toUpperCase()}
      </text>
    </svg>
  );
}
