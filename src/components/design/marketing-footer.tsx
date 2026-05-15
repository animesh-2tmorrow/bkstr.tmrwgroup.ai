// bkstr redesign — Footer for marketing pages.
//
// Heavy editorial chrome — 4 columns + 3-link bottom strip in the original
// design; the unbuilt-surface rows are removed in redesign(10) Phase 4 per
// the honesty pass (no `#` placeholder links that go nowhere). What remains:
// a brand block + 2 columns of real working links. Layout drops to 3-column
// (brand + Product + For publishers).

import Link from 'next/link';

export function MarketingFooter() {
  return (
    <footer className="border-t-2 border-ink pt-12 pb-8 text-[13px] text-ink-3">
      <div className="max-w-[1280px] mx-auto px-8">
        <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_1fr] gap-8">
          <div>
            <div className="font-serif italic text-[28px] leading-none text-ink">
              bkstr
            </div>
            <p className="mt-3 max-w-[38ch] text-ink-3">
              Compressed domain knowledge for AI agents. An imprint of Tmrw
              Group, founded 2026.
            </p>
            {/* redesign(10)/4 — removed "SOC 2 · GDPR · Stripe-billed"
                eyebrow. Stripe-billed is true but SOC 2 / GDPR aren't
                certified yet; surfacing them on the footer would be a claim
                we can't back. */}
          </div>
          <FooterColumn
            heading="Product"
            links={[
              { label: 'Catalog', href: '/storefront' },
              { label: 'Pricing', href: '/storefront' },
              { label: 'API & docs', href: '/dashboard/docs' },
              // redesign(10)/4 — Changelog row removed (no Changelog surface
              // exists today; the `href: '#'` placeholder went nowhere).
            ]}
          />
          <FooterColumn
            heading="For publishers"
            links={[
              { label: 'Publish a book', href: '/dashboard/books/new' },
              // redesign(10)/4 — Imprint guide / Royalties / House style
              // rows removed. All were `href: '#'` placeholders. When real
              // surfaces ship, add them back.
            ]}
          />
          {/* redesign(10)/4 — Company column removed in full. About / Tmrw
              Group / Security / Contact were all `href: '#'` placeholders.
              `/about` was deleted in PR 9's copy audit. */}
        </div>
        <div className="mt-8 pt-6 border-t border-rule flex flex-wrap items-baseline justify-between gap-3">
          <div>&copy; 2026 Tmrw Group. All rights reserved.</div>
          {/* redesign(10)/4 — Terms / Privacy / DPA bottom-strip links
              removed. All were `href: '#'` placeholders. The copyright line
              now stands alone in the bottom strip. */}
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
