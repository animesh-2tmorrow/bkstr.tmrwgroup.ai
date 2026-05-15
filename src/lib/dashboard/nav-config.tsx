// bkstr redesign PR 3 — nav config for the new <DashShell> primitive.
//
// Single source of truth for the dashboard sidebar's groups, items, and
// role-gating logic. Mirrors what src/components/dashboard/dashboard-shell.tsx
// currently inlines, but groups them per HANDOFF.md page-by-page §app:
// primary / publisher / admin / reference. Icons are inline SVG (HANDOFF:
// "inline SVG only" — no icon library imports).
//
// Pages migrate from the old shell to the new one PR-by-PR (PR 3 = 3 pages,
// PR 5 = admin pages, PR 6 = publisher, PR 7 = long-tail). When all pages
// have moved, delete src/components/dashboard/dashboard-shell.tsx and the
// old NAV_ITEMS const inside it.

import type { ReactNode } from 'react';
import type { DashNavGroup } from '@/components/design/dash-shell';

// ─── Inline icon set ──────────────────────────────────────────────────
// 14×14, currentColor stroke, 1.4 weight. Mirror the reference
// dashboard.jsx:11-23 Icon constant. Kept close to the nav so adding a
// new nav item doesn't require fishing through a separate icons file.
const ICON_PROPS = {
  width: 14,
  height: 14,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
} as const;

const Icon = {
  shelf: (
    <svg {...ICON_PROPS}>
      <rect x="2" y="2" width="3" height="12" />
      <rect x="6.5" y="2" width="3" height="12" />
      <rect x="11" y="2" width="3" height="12" />
    </svg>
  ),
  lib: (
    <svg {...ICON_PROPS}>
      <path d="M2 3v10M14 3v10M2 3h12M2 13h12M5 13v-7M8 13v-7M11 13v-7" />
    </svg>
  ),
  skill: (
    <svg {...ICON_PROPS}>
      <circle cx="8" cy="8" r="5" />
      <path d="M8 3v10M3 8h10" />
    </svg>
  ),
  key: (
    <svg {...ICON_PROPS}>
      <circle cx="6" cy="8" r="3" />
      <path d="M9 8h5l-2 2M12 8v3" />
    </svg>
  ),
  log: (
    <svg {...ICON_PROPS}>
      <path d="M3 4h10M3 8h10M3 12h6" />
    </svg>
  ),
  dollar: (
    <svg {...ICON_PROPS}>
      <path d="M8 2v12M11 5H6.5a2 2 0 100 4h3a2 2 0 110 4H4" />
    </svg>
  ),
  plus: (
    <svg {...ICON_PROPS}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  ),
  doc: (
    <svg {...ICON_PROPS}>
      <path d="M4 2h6l3 3v9H4z" />
      <path d="M10 2v3h3" />
    </svg>
  ),
  chart: (
    <svg {...ICON_PROPS}>
      <path d="M2 13h12M4 13V8M7 13V4M10 13v-6M13 13V6" />
    </svg>
  ),
  team: (
    <svg {...ICON_PROPS}>
      <circle cx="5" cy="6" r="2" />
      <circle cx="11" cy="6" r="2" />
      <path d="M2 13c0-2 1.5-3 3-3s3 1 3 3M8 13c0-2 1.5-3 3-3s3 1 3 3" />
    </svg>
  ),
  admin: (
    <svg {...ICON_PROPS}>
      <circle cx="8" cy="6" r="2.5" />
      <path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" />
    </svg>
  ),
  bot: (
    <svg {...ICON_PROPS}>
      <rect x="3" y="5" width="10" height="8" rx="1" />
      <path d="M8 3v2M6 8.5h0M10 8.5h0" />
    </svg>
  ),
} as const;

// ─── Item definitions (role-gated) ────────────────────────────────────
// Mirrors src/components/dashboard/dashboard-shell.tsx NAV_ITEMS. The
// `role` argument can be "ADMIN" / "PUBLISHER" / "SUBSCRIBER" or
// undefined (older session shape — falls through to subscriber-only items
// only).

type ItemDef = {
  href: string;
  label: string;
  icon: ReactNode;
  /** Required role gate. Undefined = visible to everyone signed-in. */
  visibleTo?: 'PUBLISHER_OR_ADMIN' | 'ADMIN_ONLY';
};

const PRIMARY: ItemDef[] = [
  { href: '/dashboard', label: 'Active Books', icon: Icon.shelf },
  { href: '/dashboard/library', label: 'Library', icon: Icon.lib },
  // redesign(10)/3 — Skills sidebar entry removed. The /dashboard/library
  // surface now shows books + skills together, so a separate Skills
  // entry would double-link the same content. The /skills route is a
  // 308 redirect to /storefront from this phase forward. Icon.skill is
  // retained in this file (unused) for cleanup in Phase 5.
  { href: '/dashboard/api-keys', label: 'API Keys', icon: Icon.key },
  { href: '/dashboard/fetch-logs', label: 'Fetch Logs', icon: Icon.log },
  { href: '/dashboard/billing', label: 'Billing', icon: Icon.dollar },
];

const PUBLISHER: ItemDef[] = [
  { href: '/dashboard/books/new', label: 'New Book', icon: Icon.plus, visibleTo: 'PUBLISHER_OR_ADMIN' },
  { href: '/dashboard/pricing', label: 'Pricing', icon: Icon.dollar, visibleTo: 'PUBLISHER_OR_ADMIN' },
];

const ADMIN: ItemDef[] = [
  { href: '/dashboard/admin/users', label: 'Users', icon: Icon.team, visibleTo: 'ADMIN_ONLY' },
  { href: '/dashboard/admin/books', label: 'Books', icon: Icon.admin, visibleTo: 'ADMIN_ONLY' },
  { href: '/dashboard/admin/grants', label: 'Grants', icon: Icon.key, visibleTo: 'ADMIN_ONLY' },
  { href: '/dashboard/admin/assistant', label: 'Assistant', icon: Icon.bot, visibleTo: 'ADMIN_ONLY' },
];

const REFERENCE: ItemDef[] = [
  { href: '/dashboard/docs', label: 'Docs', icon: Icon.doc },
  // /dashboard/usage + /dashboard/team-access don't exist on prod yet;
  // they're stubs in PR 7 per the operator's confirmed default. The hrefs
  // here will resolve to the existing-path NotFound until then.
  { href: '/dashboard/usage', label: 'Usage Metrics', icon: Icon.chart },
  { href: '/dashboard/team-access', label: 'Team Access', icon: Icon.team },
];

function visibleForRole(item: ItemDef, role: string | undefined): boolean {
  if (item.visibleTo === 'ADMIN_ONLY') return role === 'ADMIN';
  if (item.visibleTo === 'PUBLISHER_OR_ADMIN')
    return role === 'ADMIN' || role === 'PUBLISHER';
  return true; // visible to all signed-in roles
}

/**
 * Build the dashboard nav for a given role + active path.
 *
 * @param role     session.user.role — gates publisher/admin items.
 * @param activePath the current request path — exact match against item.href
 *                   marks that item active. (No prefix matching; siblings
 *                   like /dashboard and /dashboard/library don't conflict.)
 * @returns DashNavGroup[] consumable by <DashShell nav={...}>.
 */
export function buildDashNav(
  role: string | undefined,
  activePath: string,
): DashNavGroup[] {
  const filterAndMark = (items: ItemDef[]) =>
    items
      .filter((i) => visibleForRole(i, role))
      .map((i) => ({
        href: i.href,
        label: i.label,
        icon: i.icon,
        active: i.href === activePath,
      }));

  const groups: DashNavGroup[] = [];
  groups.push({ items: filterAndMark(PRIMARY) });
  const pubItems = filterAndMark(PUBLISHER);
  if (pubItems.length) groups.push({ label: 'Publisher', items: pubItems });
  const adminItems = filterAndMark(ADMIN);
  if (adminItems.length) groups.push({ label: 'Admin', items: adminItems });
  groups.push({ label: 'Reference', items: filterAndMark(REFERENCE) });
  return groups;
}
