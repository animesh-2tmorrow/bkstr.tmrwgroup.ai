// bkstr redesign — Footer for marketing pages.
//
// Heavy editorial chrome — 4 columns, 2px ink top border, dotted-rule
// bottom strip. Mirrors styles.css §foot lines 489-499. Kept under
// `design/` because both `/` and `/storefront` use it; future marketing
// surfaces (`/docs` per HANDOFF page-by-page) will pull it from here.
//
// Some link destinations in the original prototype (publish/imprint/
// royalties, tmrw/security, terms/privacy/dpa) don't yet exist on
// production. They're rendered as hash-only anchors for now — content
// surfaces follow in later PRs. The visual chrome is the load-bearing
// piece for the redesign.

import Link from 'next/link';
import { Eyebrow } from './eyebrow';

export function MarketingFooter() {
  return (
    <footer className="border-t-2 border-ink pt-12 pb-8 text-[13px] text-ink-3">
      <div className="max-w-[1280px] mx-auto px-8">
        <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_1fr_1fr] gap-8">
          <div>
            <div className="font-serif italic text-[28px] leading-none text-ink">
              bkstr
            </div>
            <p className="mt-3 max-w-[38ch] text-ink-3">
              Compressed domain knowledge for AI agents. An imprint of Tmrw
              Group, founded 2026.
            </p>
            <Eyebrow className="mt-5 block">SOC 2 · GDPR · Stripe-billed</Eyebrow>
          </div>
          <FooterColumn
            heading="Product"
            links={[
              { label: 'Catalog', href: '/storefront' },
              { label: 'Pricing', href: '/storefront' },
              { label: 'API & docs', href: '/dashboard/docs' },
              { label: 'Changelog', href: '#' },
            ]}
          />
          <FooterColumn
            heading="For publishers"
            links={[
              { label: 'Publish a book', href: '/dashboard/books/new' },
              { label: 'Imprint guide', href: '#' },
              { label: 'Royalties', href: '#' },
              { label: 'House style', href: '#' },
            ]}
          />
          <FooterColumn
            heading="Company"
            links={[
              // bkstr redesign PR 9 — `/about` deleted in copy audit (was a
              // Phase 5 Stream H.1 orphan with subscription-tier copy that
              // contradicted HANDOFF). Demoted to `#` placeholder pending a
              // future content surface, matching sibling placeholders.
              { label: 'About', href: '#' },
              { label: 'Tmrw Group', href: '#' },
              { label: 'Security', href: '#' },
              { label: 'Contact', href: '#' },
            ]}
          />
        </div>
        <div className="mt-8 pt-6 border-t border-rule flex flex-wrap items-baseline justify-between gap-3">
          <div>&copy; 2026 Tmrw Group. All rights reserved.</div>
          <div className="flex gap-5">
            <a href="#" className="hover:text-ink transition-colors">
              Terms
            </a>
            <a href="#" className="hover:text-ink transition-colors">
              Privacy
            </a>
            <a href="#" className="hover:text-ink transition-colors">
              DPA
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  heading,
  links,
}: {
  heading: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div>
      <h4 className="font-mono text-[10.5px] tracking-eyebrow uppercase text-ink-2 m-0 mb-3 font-medium">
        {heading}
      </h4>
      {links.map((l) => (
        <Link
          key={l.label}
          href={l.href}
          className="block py-1 text-ink-3 hover:text-ink transition-colors"
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}
