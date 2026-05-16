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
import type { BookCoverData, BookCoverPalette } from '@/components/design/book-cover';
import { getLandingStats } from '@/lib/dashboard/queries';

// Sample covers for the hero stack when the DB has fewer than 3 books
// (e.g., a fresh dev environment, or pre-launch state). These mirror the
// reference's marketing.jsx hero indices [BOOKS[0], BOOKS[2], BOOKS[3]] so
// the landing's visual demo is stable regardless of catalog size. Real
// books take over once the DB has 3+. Replace once `palette`/`glyph`
// columns ship in PR 8 and the catalog is seeded.
const SAMPLE_HERO_BOOKS: readonly BookCoverData[] = [
  {
    title: 'Marketing Operations Playbook',
    glyph: 'M',
    palette: 'saffron',
    domain: 'Marketing Ops',
    vol: 'Vol. 01',
    version: 'v2.3',
    author: 'Etumos',
  },
  {
    title: 'Agentic Quality Assurance',
    glyph: 'Q',
    palette: 'forest',
    domain: 'Agent QA',
    vol: 'Vol. 01',
    version: 'v2',
    author: 'M. Vasquez',
  },
  {
    title: 'CI Diagnostics',
    glyph: 'C',
    palette: 'indigo',
    domain: 'DevOps',
    vol: 'Vol. 03',
    version: 'v1',
    author: 'S. Lindqvist',
  },
];

export const metadata = {
  title: 'bkstr — the bookstore for AI agents',
};
export const dynamic = 'force-dynamic';

const MASTHEAD_NAV = [
  { label: 'Home', href: '/', active: true },
  { label: 'Catalog', href: '/storefront' },
  { label: 'Get started', href: '/get-started' },
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
  // PR 8 — palette + glyph join the SELECT so the hero stack + featured
  // shelf render with the same persisted typographic data the rest of the
  // app uses. The shape stays minimal — covers + slug for the link target.
  let books: {
    id: string;
    slug: string;
    title: string;
    domain: string;
    palette: string;
    glyph: string;
  }[] = [];
  try {
    books = await prisma.book.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        slug: true,
        title: true,
        domain: true,
        palette: true,
        glyph: true,
      },
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
  // redesign(10)/4 — fetch live landing stats. Defensive: if Prisma errors
  // out for any reason, render with null stats (UI omits the affected
  // tiles rather than showing fake values or 0s).
  let stats: { titlesInPrint: number | null; fetchP95Ms: number | null } = {
    titlesInPrint: null,
    fetchP95Ms: null,
  };
  try {
    const s = await getLandingStats();
    stats = { titlesInPrint: s.titlesInPrint, fetchP95Ms: s.fetchP95Ms };
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? (err as { code: string }).code
        : 'unknown';
    console.error(
      `[home/stats] getLandingStats failed (code=${code}); rendering landing without live stats.`,
    );
  }
  const titlesDisplay = stats.titlesInPrint ?? books.length;

  // Hero stack always renders 3 covers — real books if 3+ are available,
  // sample covers otherwise. This keeps the landing's visual demo stable
  // for anonymous visitors regardless of catalog size, and gives local
  // dev environments a working preview without a seeded DB.
  const heroBookCovers: BookCoverData[] =
    books.length >= 3
      ? books.slice(0, 3).map(
          (b): BookCoverData => ({
            title: b.title,
            glyph: b.glyph,
            domain: b.domain,
            palette: b.palette as BookCoverPalette,
            vol: 'Vol. 01',
            version: 'v1',
            author: '—',
          }),
        )
      : [...SAMPLE_HERO_BOOKS];
  // "On the shelf" only renders when real catalog data exists. We don't
  // pad with samples here — the section's headline ("BROWSE ALL N →")
  // is meaningless against fake data.
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
              {/* redesign(10)/4 — Catalog count uses live titlesInPrint
                  (books + skills), falling back to books.length when the
                  stats query is unavailable. "Active agents" + "Tokens
                  served (30d)" tiles removed — both were hardcoded fakes
                  and the real numbers are small enough that surfacing
                  them tells an adoption story we don't want on the
                  masthead yet. */}
              <span>
                Catalog:{' '}
                <span className="num text-ink">{titlesDisplay} titles</span>
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
            {/* redesign(10)/4 — hero stat row: AVG. TASK LIFT (+27%) and
                CONTEXT SAVED (0.47×) removed (no telemetry tables back
                them). FETCH P95 reads from live `getLandingStats()`; the
                whole row is omitted when P95 is null so we don't render
                an empty divider/eyebrow shell. */}
            {stats.fetchP95Ms !== null ? (
              <div className="flex gap-8 mt-12 items-baseline flex-wrap">
                <HeroStat
                  label="FETCH P95 · 30D"
                  value={String(Math.round(stats.fetchP95Ms))}
                  valueSuffix="ms"
                />
              </div>
            ) : null}
          </div>

          {/* Hero cover stack — three covers rotated, only renders on lg+.
              `heroBookCovers` is guaranteed length-3 (real catalog if 3+,
              SAMPLE_HERO_BOOKS otherwise) so this always renders the
              full three-cover composition. */}
          <div className="relative h-[540px] hidden lg:block">
            <div
              className="absolute left-0 top-[30px]"
              style={{ transform: 'rotate(-6deg)' }}
            >
              <BookCover book={heroBookCovers[2]} size="lg" />
            </div>
            <div
              className="absolute right-0 top-0"
              style={{ transform: 'rotate(4deg)' }}
            >
              <BookCover book={heroBookCovers[1]} size="lg" />
            </div>
            <div
              className="absolute left-[60px] bottom-0 z-10"
              style={{ transform: 'rotate(-1deg)' }}
            >
              <BookCover book={heroBookCovers[0]} size="lg" />
            </div>
          </div>
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
              {/* redesign(10)/4 — fabricated pull-quote ("HEAD OF GROWTH
                  OPS · NORTHPOINT") removed. The surrounding editorial
                  prose stands without the fake testimonial. */}
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
              {/* PR 9 a11y — step number renders at 12px (text-xs) on
                  bg-paper. text-saffron at that size is 3.97:1 contrast —
                  fails AA. Swapped to saffron-dk (4.51:1, passes). */}
              <div className="font-mono text-xs tracking-[2px] text-saffron-dk">
                {s.n}
              </div>
              <h3 className="font-serif font-normal text-[22px] leading-[1.2] mt-4 mb-2.5 tracking-tight">
                {s.t}
              </h3>
              <p className="text-ink-3 text-sm m-0 leading-[1.55]">{s.d}</p>
            </div>
          ))}
        </div>

        {/* redesign(10)/4 — replaced the fictional "A SINGLE GET" block.
            The old example pointed at api.bkstr.tmrwgroup.ai/v1/books/...
            which is NXDOMAIN and a fake GET shape. The replacement is a
            real 3-step onboarding flow with a real curl against the real
            host. Operator decision 7.3 / option B: editorial copy, no
            catalog count in the framing (small number undercuts).
            Operator decision 7.2 / both: this surface + /dashboard/docs
            both surface the Q&A endpoint; here it's a footnote pointing
            at the docs. */}
        <div className="mt-16 bg-paper-2 p-8 border border-rule">
          <Eyebrow>HOW TO GET STARTED · 3 STEPS</Eyebrow>
          <h3 className="font-serif font-normal text-[28px] leading-[1.1] mt-3 mb-6 tracking-display">
            Three steps from sign-up to your agent reading the book.
          </h3>

          <ol className="grid grid-cols-1 md:grid-cols-3 gap-6 list-none p-0 m-0">
            <li>
              <div className="font-mono text-[11px] uppercase tracking-wider text-ink-3 mb-2">
                01 · SIGN UP
              </div>
              <p className="text-ink-2 m-0 leading-[1.55]">
                Pick a book or skill from the catalog and complete checkout.
                <br />
                <span className="text-ink-3 text-[13px]">
                  (Currently sandbox cards only.)
                </span>
              </p>
              <Link
                href="/signup"
                className="inline-block mt-3 text-ink underline underline-offset-4 decoration-rule hover:decoration-ink"
              >
                Sign up free →
              </Link>
            </li>

            <li>
              <div className="font-mono text-[11px] uppercase tracking-wider text-ink-3 mb-2">
                02 · GET A KEY
              </div>
              <p className="text-ink-2 m-0 leading-[1.55]">
                Generate one API key per agent. Copy the{' '}
                <code className="font-mono text-[13px]">bks_…</code> value
                when shown — it&apos;s hash-stored and never shown again.
              </p>
              <Link
                href="/dashboard/api-keys"
                className="inline-block mt-3 text-ink underline underline-offset-4 decoration-rule hover:decoration-ink"
              >
                Generate an API key →
              </Link>
            </li>

            <li>
              <div className="font-mono text-[11px] uppercase tracking-wider text-ink-3 mb-2">
                03 · FETCH THE FILES
              </div>
              <p className="text-ink-2 m-0 leading-[1.55]">
                One real GET. Returns JSON with file paths + content. Write
                to disk; install per your agent&apos;s docs.
              </p>
            </li>
          </ol>

          <pre className="font-mono text-[13px] bg-ink text-paper p-6 overflow-x-auto leading-[1.6] mt-6 mb-0">
{`# Fetch a book's raw files (JSON)
$ curl -H "Authorization: Bearer $BKSTR_KEY" \\
       https://bkstr.tmrwgroup.ai/api/books/<slug>/files

# Returns: { "book": {...}, "files": [{"path","content","sha256"}, ...] }`}
          </pre>

          {/* get-started(d) — full-walkthrough CTA. Sits between the curl
              block and the Q&A footnote: the homepage section is the
              teaser, /get-started is the full page with screenshots.
              Dispatch JSX specified `decoration-ink-1` (no such token —
              tailwind.config.ts has ink DEFAULT + ink-2/3/4) and a bare
              `<a>`; shipped as `decoration-ink` + `<Link>` to match the
              adjacent Q&A footnote and the file's conventions. */}
          <p className="text-ink-2 text-[14px] mt-6 mb-0">
            Want the full walkthrough with screenshots?{' '}
            <Link
              href="/get-started"
              className="underline decoration-rule hover:decoration-ink underline-offset-4"
            >
              See the get-started guide →
            </Link>
          </p>

          <p className="text-ink-3 text-[13px] mt-4 mb-0">
            For Q&amp;A access against book content (Bedrock-generated
            answers), see{' '}
            <Link
              href="/dashboard/docs"
              className="underline decoration-rule hover:decoration-ink"
            >
              /dashboard/docs
            </Link>{' '}
            — the agent-fetch endpoint is the advanced path.
          </p>
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
              {/* Use the live catalog total (books + skills) when available,
                  fall back to books.length for the dev-DB / catastrophic-
                  failure case. */}
              BROWSE ALL {titlesDisplay} →
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-12 mt-6">
            {shelfBooks.map((b) => (
              <Link key={b.id} href="/storefront" className="block group">
                <BookCover
                  book={{
                    title: b.title,
                    glyph: b.glyph,
                    domain: b.domain,
                    palette: b.palette as BookCoverPalette,
                    vol: 'Vol. 01',
                    version: 'v1',
                    author: '—',
                  }}
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

      {/* DARK IMPRINT BAND
          redesign(10)/4 — operator decision recommendation B: drop the
          6-tile stat grid (only 2 of 6 had real DB-backed sources) and
          the tenant-logo strip (all 6 fabricated). Keep the editorial
          framing on the dark surface. The two real numbers (titlesInPrint
          + fetchP95Ms) get rendered as inline data in the eyebrow line so
          they keep signaling without forcing a 2-tile grid. */}
      <section className="bg-ink text-paper py-16">
        <div className="max-w-[1280px] mx-auto px-8">
          <Eyebrow className="text-paper-3">FROM THE IMPRINT</Eyebrow>
          <h2 className="font-serif text-[clamp(40px,5.5vw,64px)] leading-[1.08] tracking-display text-paper mt-4 mb-4 max-w-[20ch]">
            Edited like
            <br />
            <em className="italic text-saffron">The Atlantic.</em>
            <br />
            Indexed like
            <br />
            <em className="italic text-saffron">Stripe Docs.</em>
          </h2>
          <p className="text-paper-3 text-base leading-relaxed max-w-[60ch]">
            Every volume on bkstr is run through the house style:
            chapter-level lift testing, token budgeting, decision-tree
            extraction, and a final pass with a human editor who&apos;s
            shipped the work.
          </p>
          {/* Real-numbers eyebrow — only renders when the live values
              materialized. The titles count is always >=1 (we own at
              least one book), so this line surfaces under nearly any
              non-disaster state. */}
          {stats.titlesInPrint !== null || stats.fetchP95Ms !== null ? (
            <div className="mt-10 pt-7 border-t border-paper/20">
              <Eyebrow className="text-paper-3 block">
                {stats.titlesInPrint !== null
                  ? `${stats.titlesInPrint} TITLES IN PRINT`
                  : null}
                {stats.titlesInPrint !== null && stats.fetchP95Ms !== null
                  ? " · "
                  : null}
                {stats.fetchP95Ms !== null
                  ? `${Math.round(stats.fetchP95Ms)}MS P95 FETCH · 30D`
                  : null}
              </Eyebrow>
            </div>
          ) : null}
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

          {/* redesign(10)/4 — fabricated Stripe receipt (Northpoint, Inc.
              / 4 hardcoded book line-items / $37 total / "2,164 fetches
              month-to-date") removed. Replaced with editorial copy on
              the same panel chrome so the 2-col layout doesn't collapse.
              Real receipts live in /dashboard/billing for buyers. */}
          <div className="bg-paper-2 border border-rule p-7 self-start">
            <Eyebrow>BILLED VIA STRIPE</Eyebrow>
            <h3 className="font-serif text-[28px] leading-[1.1] tracking-display mt-3 mb-4">
              One receipt per purchase. No metering.
            </h3>
            <p className="text-ink-2 text-base leading-[1.65] m-0">
              Checkout runs on Stripe&apos;s hosted page — we never touch
              your card data. Each volume produces one receipt; lifetime
              spend, refund window, and Stripe payment IDs live in your
              billing dashboard.
            </p>
            <Link
              href="/dashboard/billing"
              className="inline-block mt-5 font-mono text-[11px] tracking-eyebrow uppercase text-ink underline underline-offset-4 decoration-rule hover:decoration-ink"
            >
              View billing dashboard →
            </Link>
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
  // redesign(10)/4 — the +-prefix was wired in for "+27%" style values
  // (the AVG TASK LIFT tile, now removed). The only remaining caller is
  // FETCH P95 which renders as "84ms" with no leading sign. Drop the
  // hardcoded "+" prefix; preserve the strip-leading-+ behavior for any
  // future caller that wants to pass "+N%".
  const display = value.startsWith('+') ? value.slice(1) : value;
  const showPlus = value.startsWith('+');
  return (
    <div>
      <Eyebrow>{label}</Eyebrow>
      <div className="font-serif italic text-[28px] tracking-display text-forest num mt-1">
        {showPlus ? <span className="not-italic text-saffron">+</span> : null}
        {display}
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

// redesign(10)/4 — STATS / TENANT_LOGOS / RECEIPT arrays removed.
//   - STATS: 6 dark-imprint tiles, only 2 of 6 had real DB sources;
//     replaced with an inline-data eyebrow.
//   - TENANT_LOGOS: 6 fabricated tenant names ("TRUSTED BY TEAMS RUNNING
//     AGENTS AT") — no permission to display, no real partners. Strip
//     removed entirely.
//   - RECEIPT: fabricated 4-line $37 Stripe receipt with "Northpoint, Inc."
//     buyer. Replaced with editorial copy in the pricing section that
//     points buyers at /dashboard/billing for their real receipts.
//
// PRICING_FACTS stays — editorial framing without verifiable claims.

const PRICING_FACTS = [
  { included: true,  note: 'Unlimited fetches across your fleet' },
  { included: true,  note: 'Free minor & patch updates' },
  { included: true,  note: '14-day refund, no questions' },
  { included: false, note: 'Recurring fees, seat math, or quotas' },
];
