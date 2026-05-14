import type { Config } from 'tailwindcss';

// bkstr redesign — design tokens per HANDOFF.md.
//
// Color strategy: paper / ink / rule are NEW flat tokens (no Tailwind default
// collisions). Accent tokens (saffron / oxblood / forest / plum) are new
// names — no collision. `indigo` and `slate` ARE Tailwind defaults — we only
// add a DEFAULT entry so `bg-indigo` (no suffix) maps to our token while
// `bg-indigo-50` etc. continue resolving to Tailwind's family (1 known
// existing call site at src/app/storefront/page.tsx:78 — page will be
// reskinned in PR 1, override preserved as a no-op safety until then).
//
// Status colors are net-new namespaced keys (`status-ok` etc.) — explicit
// names match HANDOFF.md and avoid collision with Tailwind's `green`/`red`.
//
// Font families OVERRIDE Tailwind defaults (point of the redesign): the
// 57 existing `font-serif|font-sans|font-mono` usages across 25 files
// switch from system fonts / Fraunces / Inter to Newsreader / Geist /
// JetBrains Mono on this single PR. Explicit per dispatch §2.

const config: Config = {
  content: ['./src/**/*.{ts,tsx,js,jsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        serif: [
          'Newsreader',
          'Source Serif Pro',
          'Iowan Old Style',
          'Georgia',
          'serif',
        ],
        sans: [
          'Geist',
          'Söhne',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'system-ui',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'IBM Plex Mono',
          'ui-monospace',
          'SF Mono',
          'Menlo',
          'monospace',
        ],
      },
      colors: {
        // ─── paper / ink / rule (cream + ink design system) ────────
        paper: { DEFAULT: '#F4EFE5', 2: '#ECE5D3', 3: '#E2D9C2' },
        ink: {
          DEFAULT: '#161613',
          2: '#2E2E2A',
          3: '#6B6963',
          4: '#98948A',
        },
        rule: {
          DEFAULT: 'rgba(22,22,19,0.14)',
          2: 'rgba(22,22,19,0.07)',
        },
        // ─── accents (book-cover palettes + UI accents) ────────────
        saffron: { DEFAULT: '#C46A1F', dk: '#B05A14' },
        oxblood: '#6B2424',
        forest: '#1F3D2B',
        plum: '#4B2A5C',
        // Additive only — Tailwind's full indigo/slate families stay
        // resolvable for `bg-indigo-50` etc. via merge semantics.
        indigo: { DEFAULT: '#2A3D6B' },
        slate: { DEFAULT: '#354455' },
        // ─── status colors (HANDOFF.md §Status colors) ─────────────
        'status-ok': '#2F6A3F',
        'status-warn': '#8A5818',
        'status-err': '#8E3A22',
        'status-info': '#2A4F86',
      },
      letterSpacing: {
        // Eyebrow + section labels use 0.14em / 0.18em per styles.css.
        // Tailwind defaults (`tracking-wide` 0.025em, `tracking-wider`
        // 0.05em, `tracking-widest` 0.1em) are too tight — add named
        // tokens that match the reference's actual values.
        eyebrow: '0.14em',
        section: '0.18em',
        // Display headings — HANDOFF.md typography rules.
        display: '-0.02em',
      },
      fontSize: {
        // Mono eyebrow label — matches `.eyebrow` in styles.css:125-132.
        eyebrow: ['11px', { letterSpacing: '0.14em', lineHeight: '1' }],
      },
    },
  },
  plugins: [],
};

export default config;
