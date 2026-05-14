// bkstr redesign PR 1 — public landing.
//
// REPLACES the 307 redirect (`/` → `/storefront`) that lived here from
// Stream H.1 (D15.7). The new `/` is the editorial landing per HANDOFF.md
// page-by-page: hero + premise (drop-cap prose) + four-step "how it
// works" + featured shelf + dark imprint band + one-time pricing with
// sample receipt + closing CTA + footer.
//
// Server component — fetches a small set of active books from Prisma
// for the "On the shelf" featured row. No session coupling on the
// landing; anonymous visitors are the primary audience. The book grid
// at /storefront stays client-rendered for its grant-state buttons.

import Link from 'next/link';
import { prisma } from '@/lib/db';
import {
  Masthead,
  MarketingFooter,
  SectionRule,
  Eyebrow,
  Pill,
  Button,
  BookCover,
} from '@/components/design';
import { bookToCoverData } from '@/lib/books/cover-derive';

export const metadata = {
  title: 'bkstr — the bookstore for AI agents',
};
export const dynamic = 'force-dynamic';

const MASTHEAD_NAV = [
  { label: 'Home', href: '/', active: true },
  { label: 'Catalog', href: '/storefront' },
  { label: 'Docs', href: '/dashboard/docs' },
  { label: 'Log in', href: '/login' },
];

export default async function HomePage() {
  // Pull a small set of active books for the hero stack + featured shelf.
  // Three for the shelf; the hero stack picks the first three to render
  // rotated. Order by createdAt DESC so recently-added titles surface
  // (no `featured` flag in the production schema today).
  //
  // Fault-tolerant: if Prisma rejects (DB unreachable, schema drift, local
  // dev env without a populated books table), we log the error code and
  // render the landing without the hero cover stack + featured shelf.
  // The rest of the page is content-static and doesn't depend on real
  // data — the page still gives the visitor everything except the live
  // book renders.
  let books: { id: string; slug: string; title: string; domain: string }[] = [];
  try {
    books = await prisma.book.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, slug: true, title: true, domain: true },
      orderBy: { createdAt: 'desc' },
      take: 6,
    });
  } catch (err) {
    // Log enough to root-cause without crashing the page. The Prisma
    // error class carries `.code` (e.g. P2021 = table does not exist,
    // P1001 = DB unreachable, P1003 = database does not exist) — the
    // operator can grep `[home/books]` in dev terminal output.
    const code =
      err && typeof err === 'object' && 'code' in err
        ? (err as { code: string }).code
        : 'unknown';
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[home/books] prisma.book.findMany failed (code=${code}); rendering landing without book covers. Detail: ${message}`,
    );
  }
  const heroBooks = books.slice(0, 3);
  const shelfBooks = books.slice(0, 3);

  return (
    <div className="min-h-screen bg-paper">
      <Masthead
        navItems={MASTHEAD_NAV}
        topStrip={
          <>
            <div className="flex items-center gap-4">
              <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-saffron inline-block" />
              <span>Vol. 01 / Iss. 03 · 2026</span>
            </div>
            <div className="flex items-center gap-6">
              <span>
                Catalog:{' '}
                <span className="num text-ink">{books.length} titles</span>
              </span>
              <span className="hidden md:inline">
                Active agents: <span className="num text-ink">1,284</span>
              </span>
              <span className="hidden lg:inline">
                Tokens served (30d): <span className="num text-ink">14.8M</span>
              </span>
            </div>
          </>
        }
      />

      {/* HERO */}
      <section className="max-w-[1280px] mx-auto px-8 pt-20 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-16 items-end">
          <div>
            <Eyebrow className="mb-6 block">VOL. 01 · ON THE SHELF NOW</Eyebrow>
            <h1 className="font-serif text-[clamp(56px,8vw,104px)] leading-[1.08] tracking-display m-0">
              The bookstore
              <br />
              <em className="italic">for AI agents</em>
              <span className="text-saffron">.</span>
            </h1>
            <p className="text-[19px] text-ink-2 max-w-[52ch] mt-8 leading-[1.55]">
              Domain experts publish their playbooks here — not as PDFs for
              humans, but as high-density, machine-first volumes your
              marketing-ops, QA, and DevOps agents fetch over a single API
              call. Measurably better work, per book.
            </p>
            <div className="flex gap-3.5 mt-9 items-center flex-wrap">
              <Button as="a" href="/storefront" size="lg">
                Browse the catalog →
              </Button>
              <Button as="a" href="/signup" size="lg" variant="ghost">
                Sign up free
              </Button>
            </div>
            <div className="flex gap-8 mt-12 items-baseline flex-wrap">
              <HeroStat label="AVG. TASK LIFT" value="+27%" />
              <span aria-hidden className="w-px h-11 bg-rule" />
              <HeroStat label="CONTEXT SAVED" value="0.47×" />
              <span aria-hidden className="w-px h-11 bg-rule" />
              <HeroStat label="FETCH P95" value="84" valueSuffix="ms" />
            </div>
          </div>

          {/* Hero cover stack — three covers rotated, only renders on lg+ */}
          {heroBooks.length >= 3 ? (
            <div className="relative h-[540px] hidden lg:block">
              <div
                className="absolute left-0 top-[30px]"
                style={{ transform: 'rotate(-6deg)' }}
              >
                <BookCover book={bookToCoverData(heroBooks[2])} size="lg" />
              </div>
              <div
                className="absolute right-0 top-0"
                style={{ transform: 'rotate(4deg)' }}
              >
                <BookCover book={bookToCoverData(heroBooks[1])} size="lg" />
              </div>
              <div
                className="absolute left-[60px] bottom-0 z-10"
                style={{ transform: 'rotate(-1deg)' }}
              >
                <BookCover book={bookToCoverData(heroBooks[0])} size="lg" />
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* THE PREMISE */}
      <section className="bg-paper-2 border-t border-b border-rule">
        <div className="max-w-[1280px] mx-auto px-8 py-[72px]">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-16">
            <div>
              <Eyebrow>THE PREMISE</Eyebrow>
              <h2 className="font-serif text-[clamp(40px,5.5vw,64px)] leading-[1.08] tracking-display mt-4 mb-0">
                Books, but for the
                <br />
                <em className="italic">only readers</em> that scale.
              </h2>
            </div>
            <div className="text-[17px] text-ink-2 leading-[1.65]">
              <p className="mt-0 [&::first-letter]:font-serif [&::first-letter]:text-[4.2em] [&::first-letter]:leading-[0.86] [&::first-letter]:float-left [&::first-letter]:pr-2.5 [&::first-letter]:pt-1 [&::first-letter]:italic [&::first-letter]:text-saffron">
                <strong className="text-ink">Human books</strong> are
                optimized for the medium that reads them — cover, blurb, table
                of contents, long ramps into ideas, redundancy for retention.
                None of that helps a language model.{' '}
                <strong className="text-ink">bkstr</strong> publishes the same
                expertise as an agent reads it: dense, indexed, decision-shaped,
                token-efficient.
              </p>
              <p>
                The shorthand —{' '}
                <span className="font-mono bg-paper px-2 py-0.5 border border-rule">
                  i bght bk frm bkstr
                </span>{' '}
                — is the same idea you&apos;d write longhand, with about half
                the context spent. That&apos;s what a well-edited agent-book
                delivers across an entire domain.
              </p>
              <blockquote className="mt-7 pt-7 border-t border-rule font-serif italic text-[22px] text-ink-2 leading-[1.45] m-0">
                &ldquo;A marketing-ops agent loaded with the Etumos playbook
                closed 34% more routing exceptions than the same agent reading
                our internal wiki.&rdquo;
                <Eyebrow className="mt-4 not-italic" as="div">
                  HEAD OF GROWTH OPS · NORTHPOINT
                </Eyebrow>
              </blockquote>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="max-w-[1280px] mx-auto px-8 pt-20 pb-10">
        <SectionRule label="§ HOW IT WORKS" rightLabel="FOUR STEPS" className="mt-0" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mt-9">
          {STEPS.map((s) => (
            <div key={s.n} className="border-t-2 border-ink pt-5">
              <div className="font-mono text-xs tracking-[2px] text-saffron">
                {s.n}
              </div>
              <h3 className="font-serif font-normal text-[22px] leading-[1.2] mt-4 mb-2.5 tracking-tight">
                {s.t}
              </h3>
              <p className="text-ink-3 text-sm m-0 leading-[1.55]">{s.d}</p>
            </div>
          ))}
        </div>

        {/* Inline curl + tool example */}
        <div className="mt-16 grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-8 items-center bg-paper-2 p-8 border border-rule">
          <div>
            <Eyebrow>A SINGLE GET</Eyebrow>
            <h3 className="font-serif font-normal text-[28px] leading-[1.1] mt-3 mb-3.5 tracking-display">
              Drop one line into the agent&apos;s tool layer.
            </h3>
            <p className="text-ink-3 m-0 leading-[1.55]">
              No SDK to install. Works with whatever framework you&apos;re
              shipping today — LangChain, Mastra, Inngest, or your own. Return
              value is plain markdown with a token-efficient frontmatter index.
            </p>
          </div>
          <pre className="font-mono text-[13px] bg-ink text-paper p-6 overflow-x-auto leading-[1.6] m-0">
{`# Fetch the Marketing Ops Playbook v2.3
$ curl -H "Authorization: Bearer $BKSTR_KEY" \\
       https://api.bkstr.tmrwgroup.ai/v1/books/marketing-ops

`}<span className="text-ink-4">{`# In an agent's tool definition:
`}</span>{`tools.add({
  name: "fetch_book",
  fetch: (slug) => bkstr.get(slug, { version: "latest" })
})`}
          </pre>
        </div>
      </section>

      {/* ON THE SHELF — featured 3-up. Custom rule with a Link as the
          right slot — SectionRule's rightLabel only takes a string, and
          we want this to be an underlined nav target. */}
      {shelfBooks.length > 0 ? (
        <section className="max-w-[1280px] mx-auto px-8 pt-14 pb-14">
          <div className="flex items-center gap-4 mb-12">
            <Eyebrow className="tracking-section">§ ON THE SHELF</Eyebrow>
            <span aria-hidden className="flex-1 h-px bg-ink" />
            <Link
              href="/storefront"
              className="font-mono text-[11px] tracking-section uppercase text-ink underline"
            >
              BROWSE ALL {books.length} →
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-12 mt-6">
            {shelfBooks.map((b) => (
              <Link key={b.id} href="/storefront" className="block group">
                <BookCover
                  book={bookToCoverData(b)}
                  size="lg"
                  className="w-full h-auto"
                />
                <div className="mt-4 flex items-baseline justify-between gap-2">
                  <div className="font-serif text-[22px] leading-[1.15] text-ink tracking-tight">
                    {b.title}
                  </div>
                </div>
                <div className="font-serif italic text-[14px] mt-1 text-ink-3">
                  in {b.domain}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* DARK IMPRINT BAND */}
      <section className="bg-ink text-paper py-16">
        <div className="max-w-[1280px] mx-auto px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <Eyebrow className="text-paper-3">FROM THE IMPRINT</Eyebrow>
              <h2 className="font-serif text-[clamp(40px,5.5vw,64px)] leading-[1.08] tracking-display text-paper mt-4 mb-4">
                Edited like
                <br />
                <em className="italic text-saffron">The Atlantic.</em>
                <br />
                Indexed like
                <br />
                <em className="italic text-saffron">Stripe Docs.</em>
              </h2>
              <p className="text-paper-3 text-base leading-relaxed max-w-[44ch]">
                Every volume on bkstr is run through the house style:
                chapter-level lift testing, token budgeting, decision-tree
                extraction, and a final pass with a human editor who&apos;s
                shipped the work.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-px bg-rule">
              {STATS.map((s) => (
                <div key={s.label} className="bg-ink p-6">
                  <div className="font-serif text-[40px] leading-none text-saffron tracking-display num">
                    {s.value}
                  </div>
                  <Eyebrow className="mt-2.5 block text-paper-3">
                    {s.label}
                  </Eyebrow>
                </div>
              ))}
            </div>
          </div>

          {/* Tenant logos — pure-text "logos" per HANDOFF (no images) */}
          <div className="mt-14 pt-7 border-t border-paper/20">
            <Eyebrow className="text-paper-3 mb-4 block">
              TRUSTED BY TEAMS RUNNING AGENTS AT
            </Eyebrow>
            <div className="flex flex-wrap gap-x-14 gap-y-8 items-center opacity-85">
              {TENANT_LOGOS.map((l) => (
                <span key={l.name} className={l.cls}>
                  {l.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* PRICING + SAMPLE RECEIPT */}
      <section className="max-w-[1280px] mx-auto px-8 py-20">
        <SectionRule
          label="§ PRICING"
          rightLabel="ONE-TIME PURCHASE PER VOLUME"
          className="mt-0"
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 mt-10 items-start">
          <div>
            <h2 className="font-serif text-[44px] leading-[1.1] tracking-display m-0">
              No subscriptions.
              <br />
              <em className="italic">You own the book.</em>
            </h2>
            <p className="text-ink-2 text-base leading-[1.65] mt-6 max-w-[48ch]">
              Every volume is a one-time purchase between{' '}
              <strong>$5</strong> and <strong>$14</strong>. Pay once, fetch as
              many times as your agents need. Updates within a major version
              are free — we email you when a new edition drops, and you decide
              whether to upgrade.
            </p>
            <div className="mt-8 pt-7 border-t border-rule grid grid-cols-1 sm:grid-cols-2 gap-6">
              {PRICING_FACTS.map((p) => (
                <div key={p.note}>
                  <Eyebrow className={p.included ? 'text-forest' : 'text-oxblood'}>
                    {p.included ? '✓ INCLUDED' : '— NOT INCLUDED'}
                  </Eyebrow>
                  <div className="mt-1.5 text-[14.5px] text-ink-2">{p.note}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-3.5 mt-9 flex-wrap">
              <Button as="a" href="/storefront" size="lg">
                See all prices →
              </Button>
              <Button as="a" href="/dashboard/docs" size="lg" variant="ghost">
                Read the docs
              </Button>
            </div>
          </div>

          {/* Sample receipt */}
          <div className="bg-paper-2 border border-rule p-7">
            <div className="flex justify-between items-baseline">
              <Eyebrow>SAMPLE RECEIPT · STRIPE</Eyebrow>
              <span className="font-mono text-[11px] text-ink-3">
                rcpt_4xK9b21
              </span>
            </div>
            <div className="mt-4 font-serif text-[24px] tracking-tight">
              Northpoint, Inc.
              <span className="text-ink-3 text-sm font-sans not-italic ml-2.5">
                · May 12, 2026
              </span>
            </div>
            <div className="mt-5 border-t border-rule">
              {RECEIPT.map((r) => (
                <div
                  key={r.t}
                  className="py-2.5 flex items-baseline text-sm gap-2"
                >
                  <span className="font-serif">
                    {r.t}{' '}
                    <span className="font-mono text-[11px] text-ink-3 ml-1.5">
                      {r.v}
                    </span>
                  </span>
                  <span className="flex-1 border-b border-dotted border-rule -mt-1" />
                  <span className="num font-mono text-[13px]">${r.p}.00</span>
                </div>
              ))}
              <div className="py-4 pb-1 flex items-baseline text-base border-t border-rule mt-2 gap-2 font-serif">
                <strong>Total · paid once</strong>
                <span className="flex-1 border-b border-dotted border-rule -mt-1" />
                <strong className="num">$37.00</strong>
              </div>
              <div className="mt-4 pt-3 border-t border-dashed border-rule flex justify-between font-mono text-[11px] text-ink-3 tracking-[1px]">
                <span>FETCHES MONTH-TO-DATE</span>
                <span>2,164</span>
              </div>
              <div className="flex justify-between font-mono text-[11px] text-ink-3 tracking-[1px] mt-1">
                <span>EFFECTIVE COST / FETCH</span>
                <span>$0.017</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CLOSING CTA */}
      <section className="bg-paper-2 border-t border-rule">
        <div className="max-w-[1280px] mx-auto px-8 py-20 text-center">
          <Eyebrow>FROM THE EDITORS</Eyebrow>
          <h2 className="font-serif text-[clamp(40px,5.5vw,64px)] leading-[1.08] tracking-display mt-4 max-w-[20ch] mx-auto">
            Give your agents the
            <br />
            <em className="italic">same shelf</em> the experts read.
          </h2>
          <div className="flex gap-3.5 justify-center mt-9 flex-wrap">
            <Button as="a" href="/storefront" size="lg">
              Browse the catalog →
            </Button>
            <Button as="a" href="/signup" size="lg" variant="ghost">
              Sign up free
            </Button>
          </div>
          <Eyebrow className="mt-6 block">
            SIGN UP FREE · ONE-TIME PURCHASE PER VOLUME · 14-DAY REFUND
          </Eyebrow>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

// ─── content blocks ─────────────────────────────────────────────────────

function HeroStat({
  label,
  value,
  valueSuffix,
}: {
  label: string;
  value: string;
  valueSuffix?: string;
}) {
  return (
    <div>
      <Eyebrow>{label}</Eyebrow>
      <div className="font-serif italic text-[28px] tracking-display text-forest num mt-1">
        <span className="not-italic text-saffron">+</span>
        {value.startsWith('+') ? value.slice(1) : value}
        {valueSuffix ? (
          <span className="not-italic text-ink-3 text-lg">{valueSuffix}</span>
        ) : null}
      </div>
    </div>
  );
}

const STEPS = [
  {
    n: '01',
    t: 'Browse the catalog',
    d: 'Sign up free. Read excerpts, lift scores, and the full table of contents before you buy.',
  },
  {
    n: '02',
    t: 'Buy the books you need',
    d: 'One-time purchase per volume — $5 to $14. Stripe checkout. Refund within 14 days, no questions.',
  },
  {
    n: '03',
    t: 'Issue API keys to your agents',
    d: 'Scope keys per agent, per book, per environment. Rotate without redeploy. A single GET returns the volume.',
  },
  {
    n: '04',
    t: 'Measure the lift',
    d: 'Per-book fetch logs, agent attribution, and the lift score we publish per title. Buy more shelves as you grow.',
  },
];

const STATS = [
  { value: '10', label: 'TITLES IN PRINT' },
  { value: '1,284', label: 'AGENTS SUBSCRIBED' },
  { value: '14.8M', label: 'TOKENS SERVED, 30D' },
  { value: '84ms', label: 'EDGE P95 LATENCY' },
  { value: '+27%', label: 'AVG. LIFT SCORE' },
  { value: '9', label: 'PUBLISHING HOUSES' },
];

const TENANT_LOGOS: { name: string; cls: string }[] = [
  { name: 'Etumos', cls: 'font-serif italic text-[22px] text-paper tracking-tight' },
  { name: 'Northpoint', cls: 'font-sans font-bold text-[22px] text-paper tracking-tight' },
  { name: 'Plait', cls: 'font-mono text-base text-paper tracking-[0.04em]' },
  { name: 'Helmsley', cls: 'font-serif text-[22px] text-paper tracking-tight' },
  { name: 'Sunday Studio', cls: 'font-serif italic text-[22px] text-paper tracking-tight' },
  { name: 'Tribune Labs', cls: 'font-sans font-bold text-[22px] text-paper tracking-tight' },
];

const PRICING_FACTS = [
  { included: true,  note: 'Unlimited fetches across your fleet' },
  { included: true,  note: 'Free minor & patch updates' },
  { included: true,  note: '14-day refund, no questions' },
  { included: false, note: 'Recurring fees, seat math, or quotas' },
];

const RECEIPT = [
  { t: 'Marketing Operations Playbook', v: 'v2.3', p: 12 },
  { t: 'Agentic Quality Assurance', v: 'v2', p: 12 },
  { t: 'CI Diagnostics', v: 'v1', p: 5 },
  { t: 'Hermes Dogfood', v: 'v1', p: 8 },
];
