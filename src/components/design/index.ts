// bkstr redesign — design-system primitive re-exports.
//
// Lets callers do `import { Button, Pill, Eyebrow } from '@/components/design'`
// instead of threading each path separately. Pages built in PR 1+ use this
// barrel; primitive types are re-exported too for downstream typing.

export { Eyebrow } from './eyebrow';
export { Pill } from './pill';
export type { PillVariant } from './pill';
export { Button } from './button';
export type { ButtonVariant, ButtonSize } from './button';
export { SectionRule } from './section-rule';
export { BookCover } from './book-cover';
export type {
  BookCoverData,
  BookCoverPalette,
  BookCoverSize,
} from './book-cover';
export { StatCard } from './stat-card';
export type { StatCardProps } from './stat-card';
export { Masthead } from './masthead';
export type { MastheadNavItem, MastheadProps } from './masthead';
export { DashShell } from './dash-shell';
export type { DashShellProps, DashNavGroup, DashNavItem } from './dash-shell';
export { MarketingFooter } from './marketing-footer';
