// get-started Phase C — editorial onboarding page.
//
// Single Next.js server component. Embeds the 9 screenshots committed by
// Phase B (public/get-started/0[1-9]-*.png) into the canonical onboarding
// narrative locked in Phase A: hero → what is bkstr → 3 steps → install
// reference for 4 agents → FAQ → CTA.
//
// Aesthetic: editorial, not templated. Honest about what bkstr is and
// what it isn't. No fabricated metrics, no "10x" claims, no synthetic
// testimonials. Copy is real and considered.
//
// Phase A's outline locked the structure; Phase B captured the visual
// evidence; this Phase C pass turns those two into a page. Phase D
// (not yet shipped) will add the homepage CTA, the masthead nav entry,
// and the deploy — this page exists as a parallel surface until then.
//
// Per dispatch: server component (no "use client"), next/image with
// priority on first screenshot + lazy on the rest, max-width ~1100px
// container, mobile-readable at 380px, existing design tokens only.

import Link from "next/link";
import Image from "next/image";
import {
  Masthead,
  MarketingFooter,
  Eyebrow,
  Pill,
  Button,
  SectionRule,
  type MastheadNavItem,
} from "@/components/design";

export const metadata = {
  title: "Get started | bkstr",
  description:
    "Buy a book, fetch its files via API, install per your agent's docs. Three steps to your agent's first read.",
};

const NAV: ReadonlyArray<MastheadNavItem> = [
  { label: "Home", href: "/" },
  { label: "Catalog", href: "/storefront" },
  // Phase A locked "Get started" as a parallel marketing surface; Phase D
  // adds the homepage + masthead linkage. Until then, this page is
  // discoverable only by direct URL (and from share links).
  { label: "Get started", href: "/get-started", active: true },
  { label: "Docs", href: "/dashboard/docs" },
  { label: "Log in", href: "/login" },
];

// Container max-width per dispatch's "Page max-width: ~1100px container
// (matches existing bkstr pages)". Marketing surfaces elsewhere use
// max-w-[1280px]; the dispatch's narrower spec keeps editorial prose at
// readable measure on wide displays.
const CONTAINER = "max-w-[1100px] mx-auto px-6 sm:px-8";

export default function GetStartedPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Masthead
        navItems={[...NAV]}
        topStrip={
          <>
            <div className="flex items-center gap-4">
              <span
                aria-hidden
                className="w-1.5 h-1.5 rounded-full bg-saffron inline-block"
              />
              <span>Vol. 01 · Getting started</span>
            </div>
            <div className="flex items-center gap-6">
              <span>Est. time · 3 minutes</span>
            </div>
          </>
        }
      />

      <main>
        <HeroSection />
        <WhatIsBkstrSection />
        <ThreeStepsSection />
        <InstallReferenceSection />
        <FaqSection />
        <CtaSection />
      </main>

      <MarketingFooter />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// HERO
// ─────────────────────────────────────────────────────────────────────────

function HeroSection() {
  return (
    <section className={`${CONTAINER} pt-16 pb-20`}>
      <Eyebrow className="mb-6 block">§ GET STARTED · 3 MINUTES</Eyebrow>
      <h1 className="font-serif font-normal text-[clamp(44px,7vw,72px)] leading-[1.05] tracking-display text-ink m-0">
        Three minutes from sign-up
        <br />
        <em className="italic">to your agent&apos;s first read</em>
        <span className="text-saffron">.</span>
      </h1>
      <p className="text-[19px] text-ink-2 mt-7 mb-9 leading-[1.55] max-w-[62ch]">
        Buy a book. Run one command. A fresh bundle of context — versioned,
        paid-for, hash-stored — unpacks straight into your agent&apos;s
        skills directory.
      </p>

      {/* The install command — the curl one-liner and the npm CLI
          equivalent. gif-grep is a free item; the mkdir -p makes the curl
          form copy-paste safely on a fresh machine where ~/.claude/skills/
          doesn't exist yet. The install section further down covers paid
          items + the 4 agents. */}
      <pre className="font-mono text-[13px] bg-ink text-paper p-6 overflow-x-auto leading-[1.6] mt-0 mb-9 max-w-[820px]">
{`# Install gif-grep (free) — copy-paste, runs as-is on a fresh machine
$ mkdir -p ~/.claude/skills && curl -sL https://bkstr.tmrwgroup.ai/api/install/gif-grep | tar xz -C ~/.claude/skills/

# Or with the bkstr CLI (npm) — zero install via npx
$ npx -y @clawbot678/bkstr install gif-grep`}
      </pre>

      <div className="flex gap-3.5 items-center flex-wrap">
        <Button as="a" href="/storefront" size="lg">
          Browse the catalog →
        </Button>
        <Button as="a" href="/signup" size="lg" variant="ghost">
          Sign up free
        </Button>
      </div>

      {/* Substantiated badges only. VOL. 01 mirrors the editorial
          framing; STRIPE-BILLED is a real billing claim; EST. 2026 is
          accurate. No fabricated metrics (no "10× faster", no "1,000
          agents shipped" — both would be fabrication today). */}
      <div className="flex gap-2 items-center flex-wrap mt-8">
        <Pill variant="neutral">VOL. 01</Pill>
        <Pill variant="neutral">EST. 2026</Pill>
        <Pill variant="neutral">STRIPE-BILLED · NO SUBSCRIPTION</Pill>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// WHAT IS BKSTR — honesty framing block (verbatim per dispatch)
// ─────────────────────────────────────────────────────────────────────────

function WhatIsBkstrSection() {
  return (
    <section
      id="what"
      className="bg-paper-2 border-t border-b border-rule scroll-mt-16"
    >
      <div className={`${CONTAINER} pt-16 pb-20`}>
        <Eyebrow className="mb-6 block">§ WHAT IS BKSTR</Eyebrow>
        <h2 className="font-serif font-normal text-[clamp(32px,4.5vw,48px)] leading-[1.1] tracking-display text-ink m-0 mb-10 max-w-[18ch]">
          A catalog of books your <em className="italic">agent</em> can read.
        </h2>

        {/* The honesty callout. Two paragraphs — first defines, second
            is the deliberate counterweight. Left border in saffron-dk
            anchors the block as a callout, matches the academic-research-
            skills README aesthetic without aping it. Wider line-height
            for legibility; the second paragraph stays paper-1 (not
            paper-2 — it's emphatic, not subordinate). */}
        <div className="border-l-4 border-saffron-dk bg-paper pl-6 sm:pl-8 pr-6 sm:pr-8 py-7 max-w-[68ch]">
          <p className="text-[17px] text-ink leading-[1.65] m-0">
            <strong className="text-ink font-semibold">What bkstr is.</strong>{" "}
            A catalog of books — bundles of files your AI agent reads. Pay
            once per book. Fetch the files via API. Install per your
            agent&apos;s docs.
          </p>
          <p className="text-[17px] text-ink-2 leading-[1.65] mt-5 mb-0">
            <strong className="text-ink font-semibold">
              What bkstr isn&apos;t.
            </strong>{" "}
            A prompt store. A no-code agent builder. A subscription. We
            don&apos;t run your agent for you; we don&apos;t see your
            conversations; we don&apos;t claim our books make any specific
            agent X% better. Quality varies by book and by use case.
          </p>
        </div>

        {/* Mental model — three text columns, no SVG icons. The
            arrow-y rhythm reads in any locale and ages better than
            illustrations. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-14">
          <MentalModelColumn
            step="01"
            title="Book"
            body="One purchase. Authored by a domain expert, versioned, hash-stored. Your access starts the moment Stripe webhook fires."
          />
          <MentalModelColumn
            step="02"
            title="Files"
            body="The bundle — markdown chapters for books, executable files for skills. Delivered as a gzipped tarball that unpacks straight to disk."
          />
          <MentalModelColumn
            step="03"
            title="Agent"
            body="Claude Code, Cursor, Cline, Aider — anything that can read files on disk. Install per the agent's convention; bkstr doesn't run it for you."
          />
        </div>
      </div>
    </section>
  );
}

function MentalModelColumn({
  step,
  title,
  body,
}: {
  step: string;
  title: string;
  body: string;
}) {
  return (
    <div className="border-t-2 border-ink pt-5">
      <div className="font-mono text-xs tracking-[2px] text-saffron-dk">
        {step}
      </div>
      <h3 className="font-serif font-normal text-[22px] leading-[1.2] mt-3 mb-2.5 tracking-tight text-ink">
        {title}
      </h3>
      <p className="text-ink-3 text-sm m-0 leading-[1.55]">{body}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// THE 3 STEPS — alternating left/right with embedded screenshots
// ─────────────────────────────────────────────────────────────────────────

function ThreeStepsSection() {
  return (
    <section id="steps" className={`${CONTAINER} pt-20 pb-12 scroll-mt-16`}>
      <SectionRule label="§ THE 3 STEPS" rightLabel="ON ONE PAGE" className="my-0" />

      <div className="mt-14 space-y-20">
        {/* capture: s-05 */}
        <StepRow
          step="01"
          title="Sign up free."
          body={
            <>
              Google OAuth — two clicks, no credit card, no email
              verification, no plan picker. Your account exists as soon as
              Google says you&apos;re you. The dashboard greets you with an
              empty library; the catalog is one click away.
            </>
          }
          imageSrc="/docs/screenshots/s-05-signup-form.png"
          imageAlt="Signup form (Google OAuth)"
          imageWidth={1440}
          imageHeight={900}
          imageSide="right"
          priority
        />

        {/* capture: s-12 */}
        <StepRow
          step="02"
          title="Browse the catalog and buy a book."
          body={
            <>
              The catalog mixes books (read-as-context) and skills
              (install-and-run) in one unified grid. Pick one and choose
              Buy — checkout runs on Stripe. It is in test mode during the
              beta, so checkout takes a test card and no real charge is
              made; live billing is coming. Access is granted the moment
              Stripe&apos;s webhook reaches bkstr.
            </>
          }
          imageSrc="/docs/screenshots/s-12-stripe-checkout-pre-card.png"
          imageAlt="Stripe test-mode checkout for agentic-qa-manual, pre-card-entry"
          imageWidth={1440}
          imageHeight={900}
          imageSide="left"
        />

        {/* capture: s-22 */}
        <StepRow
          step="03"
          title="Install with one command."
          body={
            <>
              Own it? Install it with a single{" "}
              <code className="font-mono text-[0.85em] bg-paper-2 px-1">
                curl … | tar xz
              </code>{" "}
              — the command fetches the bundle and unpacks it straight into
              your agent&apos;s skills directory. Prefer a tool? The bkstr
              CLI does the same —{" "}
              <code className="font-mono text-[0.85em] bg-paper-2 px-1">
                npx -y @clawbot678/bkstr install &lt;slug&gt;
              </code>
              . The dashboard&apos;s API-access panel hands you the exact
              command — curl or CLI — for any item you own, free or paid.
            </>
          }
          imageSrc="/docs/screenshots/s-22-paid-install-cli.png"
          imageAlt="CLI install of an owned paid item (keyed)"
          imageWidth={1440}
          imageHeight={900}
          imageSide="right"
        />
      </div>
    </section>
  );
}

function StepRow({
  step,
  title,
  body,
  imageSrc,
  imageAlt,
  imageWidth,
  imageHeight,
  imageSide,
  priority = false,
}: {
  step: string;
  title: string;
  body: React.ReactNode;
  imageSrc: string;
  imageAlt: string;
  imageWidth: number;
  imageHeight: number;
  imageSide: "left" | "right";
  priority?: boolean;
}) {
  const textBlock = (
    <div>
      <div className="font-mono text-xs tracking-[2px] text-saffron-dk">
        {step}
      </div>
      <h3 className="font-serif font-normal text-[clamp(28px,3.5vw,36px)] leading-[1.1] tracking-display mt-3 mb-5 text-ink">
        {title}
      </h3>
      <p className="text-[16.5px] text-ink-2 leading-[1.65] m-0 max-w-[52ch]">
        {body}
      </p>
    </div>
  );

  const imageBlock = (
    <div className="border border-rule shadow-sm bg-paper-2 p-1">
      <Image
        src={imageSrc}
        alt={imageAlt}
        width={imageWidth}
        height={imageHeight}
        priority={priority}
        // sizes hints next/image's <img srcset>: the column the image
        // sits in is 1/2 the container width on lg+, full width on
        // smaller. The container caps at 1100px, so column = 550px on
        // lg+; below sm the image goes full width.
        sizes="(min-width: 1024px) 550px, 100vw"
        className="block w-full h-auto"
      />
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">
      {imageSide === "left" ? (
        <>
          {imageBlock}
          {textBlock}
        </>
      ) : (
        <>
          {textBlock}
          {imageBlock}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// INSTALL REFERENCE — Claude Code (canonical) + 3 others (provisional)
// ─────────────────────────────────────────────────────────────────────────

function InstallReferenceSection() {
  return (
    <section id="install" className="bg-paper-2 border-t border-b border-rule scroll-mt-16">
      <div className={`${CONTAINER} pt-20 pb-20`}>
        <SectionRule
          label="§ INSTALL · FOR YOUR AGENT"
          rightLabel="4 PATHS"
          className="my-0"
        />

        <div className="mt-10 max-w-[64ch]">
          <p className="text-[16px] text-ink-2 leading-[1.65] m-0">
            One command, four destinations. The install endpoint streams a
            gzipped tarball; <code className="font-mono text-[0.9em]">tar xz -C &lt;dir&gt;</code>{" "}
            unpacks it wherever your agent reads files. Claude Code is the
            canonical target; Cursor, Cline, and Aider are provisional —
            based on each agent&apos;s documented configuration model, not
            yet stress-tested by us in the wild.
          </p>
        </div>

        {/* CLAUDE CODE — canonical install. The one-liner: fetch the
            install endpoint, pipe straight into tar. */}
        <div className="mt-14">
          <div className="flex items-baseline gap-3 mb-3">
            <Eyebrow>CLAUDE CODE</Eyebrow>
            <Pill variant="status-ok">Canonical</Pill>
          </div>
          <h3 className="font-serif font-normal text-[26px] leading-[1.15] tracking-tight text-ink mb-4">
            One command — fetch and unpack.
          </h3>
          <p className="text-ink-2 text-[15px] leading-[1.65] mb-5 max-w-[64ch]">
            The install endpoint streams a gzipped tarball; pipe it into{" "}
            <code className="font-mono text-ink-2">tar xz</code> and the
            bundle lands under{" "}
            <code className="font-mono text-ink-2">
              ~/.claude/skills/&lt;slug&gt;/
            </code>
            . Free items install anonymously. Paid items take a Bearer
            token — create a key at{" "}
            <Link
              href="/dashboard/api-keys"
              className="underline decoration-rule hover:decoration-ink"
            >
              /dashboard/api-keys
            </Link>{" "}
            and export it as{" "}
            <code className="font-mono text-ink-2">$BKSTR_KEY</code>. Re-run
            any time the publisher ships a new version — the writes
            overwrite.
          </p>
          <pre className="font-mono text-[12.5px] bg-ink text-paper p-6 overflow-x-auto leading-[1.6] m-0">
{`# Free item — copy-paste, runs as-is on a fresh machine
mkdir -p ~/.claude/skills && curl -sL https://bkstr.tmrwgroup.ai/api/install/gif-grep | tar xz -C ~/.claude/skills/

# Paid item — paste BOTH lines together (the export feeds the curl)
export BKSTR_KEY=bks_your_key_here
mkdir -p ~/.claude/skills && curl -sL -H "Authorization: Bearer $BKSTR_KEY" https://bkstr.tmrwgroup.ai/api/install/<slug> | tar xz -C ~/.claude/skills/`}
          </pre>
          <p className="text-ink-3 text-[13px] leading-[1.6] mt-4 mb-0 max-w-[64ch]">
            The tarball is namespaced under{" "}
            <code className="font-mono text-ink-2">&lt;slug&gt;/</code>, so
            extracting to{" "}
            <code className="font-mono text-ink-2">~/.claude/skills/</code>{" "}
            keeps each install in its own directory. Books and skills use
            the same endpoint and the same command.
          </p>

          {/* The CLI alternative — npm-distributed, same install. Equal
              weight on this longer-form guide (the homepage keeps curl
              primary). */}
          <div className="mt-8 pt-8 border-t border-rule">
            <div className="flex items-baseline gap-3 mb-3">
              <Eyebrow>OR · THE BKSTR CLI</Eyebrow>
              <Pill variant="neutral">npm</Pill>
            </div>
            <h3 className="font-serif font-normal text-[26px] leading-[1.15] tracking-tight text-ink mb-4">
              Same install, as a command.
            </h3>
            <p className="text-ink-2 text-[15px] leading-[1.65] mb-5 max-w-[64ch]">
              Prefer a tool to a pipeline?{" "}
              <code className="font-mono text-ink-2">@clawbot678/bkstr</code>{" "}
              is the same install as an npm CLI — run it with{" "}
              <code className="font-mono text-ink-2">npx</code> for zero
              install, or install it globally. For paid items,{" "}
              <code className="font-mono text-ink-2">bkstr login</code> stores
              your key once — no{" "}
              <code className="font-mono text-ink-2">export</code> line, nothing
              left in shell history.{" "}
              <code className="font-mono text-ink-2">--dir</code> retargets the
              unpack to any directory (Cursor&apos;s{" "}
              <code className="font-mono text-ink-2">.cursor/rules/</code>, a
              project folder, anywhere).
            </p>
            <pre className="font-mono text-[12.5px] bg-ink text-paper p-6 overflow-x-auto leading-[1.6] m-0">
{`# Free item — zero install, runs straight from npm
npx -y @clawbot678/bkstr install gif-grep

# Paid item — install once, log in, then install anything you own
npm install -g @clawbot678/bkstr
bkstr login
bkstr install <slug>`}
            </pre>
            <p className="text-ink-3 text-[13px] leading-[1.6] mt-4 mb-0 max-w-[64ch]">
              Source and issues:{" "}
              <a
                href="https://github.com/tmrwgroup/bkstr-cli"
                className="text-ink underline decoration-rule hover:decoration-ink"
              >
                github.com/tmrwgroup/bkstr-cli
              </a>
              .
            </p>
          </div>
        </div>

        {/* THE OTHER THREE — short, footnoted. Same one-liner, only the
            tar -C destination changes per agent. */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-16">
          <ProvisionalAgent
            name="CURSOR"
            blurb={
              <>
                Unpack into{" "}
                <code className="font-mono text-ink-2">.cursor/rules/</code>{" "}
                inside your project. Cursor reads them as project rules; the
                agent inherits the bundle when it scopes to your repo.
              </>
            }
            snippet={`mkdir -p .cursor/rules && curl -sL https://bkstr.tmrwgroup.ai/api/install/<slug> | tar xz -C .cursor/rules/
# or, with the bkstr CLI:
npx -y @clawbot678/bkstr install <slug> --dir .cursor/rules`}
          />
          <ProvisionalAgent
            name="CLINE"
            blurb={
              <>
                No fixed install directory — Cline reads any file you
                @-mention. Unpack under{" "}
                <code className="font-mono text-ink-2">./bkstr/</code> and
                reference paths from the chat panel.
              </>
            }
            snippet={`mkdir -p bkstr && curl -sL https://bkstr.tmrwgroup.ai/api/install/<slug> | tar xz -C bkstr/
# or, with the bkstr CLI: npx -y @clawbot678/bkstr install <slug> --dir bkstr
# then @bkstr/<slug>/SKILL.md in the panel`}
          />
          <ProvisionalAgent
            name="AIDER"
            blurb={
              <>
                Aider takes files via the{" "}
                <code className="font-mono text-ink-2">/read</code> command
                or the{" "}
                <code className="font-mono text-ink-2">--read</code> flag.
                Unpack anywhere; add the paths you want active.
              </>
            }
            snippet={`mkdir -p ~/bkstr && curl -sL https://bkstr.tmrwgroup.ai/api/install/<slug> | tar xz -C ~/bkstr/
# or, with the bkstr CLI: npx -y @clawbot678/bkstr install <slug> --dir ~/bkstr
# then aider --read ~/bkstr/<slug>/SKILL.md`}
          />
        </div>

        <p className="text-ink-3 text-[13px] leading-[1.65] mt-10 max-w-[68ch] italic">
          Cursor, Cline, and Aider instructions above are provisional — based
          on each agent&apos;s documented configuration model, not on
          internal testing by bkstr. If you run a clean install on any of
          them and the convention here is wrong, write to{" "}
          <a
            href="mailto:lab@tmrwgroup.ai"
            className="not-italic text-ink underline decoration-rule hover:decoration-ink"
          >
            lab@tmrwgroup.ai
          </a>{" "}
          and we&apos;ll correct it.
        </p>

        {/* ADVANCED — the raw per-file JSON endpoint, demoted below the
            one-liner. Still fully documented for callers who'd rather
            handle the files themselves. */}
        <div className="mt-16 border border-rule bg-paper p-8">
          <Eyebrow className="block mb-4">§ ADVANCED · RAW JSON</Eyebrow>
          <p className="text-ink-2 text-[15px] leading-[1.65] mt-0 mb-5 max-w-[64ch]">
            Prefer to handle the files yourself rather than pipe a tarball?{" "}
            <code className="font-mono">GET /api/books/&lt;slug&gt;/files</code>{" "}
            (and the <code className="font-mono">/api/skills/…</code>{" "}
            equivalent) returns per-file JSON instead — the shape below.{" "}
            <code className="font-mono">path</code> is relative to the
            bundle root, <code className="font-mono">content</code> is the
            raw file content, <code className="font-mono">sha256</code> is
            the file&apos;s hash for cache validation. This is the
            programmatic-access surface; the one-liner above is the
            supported install path.
          </p>
          <pre className="font-mono text-[12.5px] bg-ink text-paper p-6 overflow-x-auto leading-[1.6] m-0">
{`{
  "kind": "book",
  "slug": "self-upgrade-engineer",
  "version": "v1",
  "files": [
    {
      "path": "chapters/foundations.md",
      "content": "# Foundations\\n\\nShipping well as a senior engineer starts...",
      "sha256": "0fe2…8a1b"
    },
    {
      "path": "chapters/ownership.md",
      "content": "# Ownership\\n\\nThe gap between maintaining code and owning...",
      "sha256": "ab3c…09d2"
    }
    // ... one entry per chapter in the book
  ]
}`}
          </pre>
        </div>

        <p className="text-ink-3 text-[13px] mt-8 mb-0 max-w-[68ch]">
          Looking for the Q&amp;A endpoint? That&apos;s the advanced
          path — books answer questions over their own content via{" "}
          <Link
            href="/dashboard/docs/qa-endpoint"
            className="text-ink underline decoration-rule hover:decoration-ink"
          >
            the Q&amp;A endpoint reference
          </Link>
          . The files endpoint shown here is the primary path; Q&amp;A is
          books-only and intended for grounded retrieval, not install.
        </p>
      </div>
    </section>
  );
}

function ProvisionalAgent({
  name,
  blurb,
  snippet,
}: {
  name: string;
  blurb: React.ReactNode;
  snippet: string;
}) {
  return (
    <div className="border-t-2 border-ink pt-5">
      <Eyebrow>{name}</Eyebrow>
      <p className="text-ink-2 text-[14.5px] leading-[1.6] mt-3 mb-4">
        {blurb}
      </p>
      <pre className="font-mono text-[11.5px] bg-ink text-paper p-4 overflow-x-auto leading-[1.5] m-0">
        {snippet}
      </pre>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// FAQ — 6 disclosed questions
// ─────────────────────────────────────────────────────────────────────────

type FaqEntry = { q: string; a: React.ReactNode };

const FAQ: ReadonlyArray<FaqEntry> = [
  {
    q: "What's the difference between a book and a skill?",
    a: (
      <>
        Both are bundles of files; the difference is how your agent uses
        them. <strong>Books</strong> are documents the agent reads as
        context — chapters of markdown, designed for grounded retrieval.{" "}
        <strong>Skills</strong> are files the agent installs and executes —
        a{" "}
        <code className="font-mono">SKILL.md</code> plus the scripts /
        configs / templates that make it run. The catalog treats them as
        one product type because the buy + fetch flow is identical; the
        install path differs by agent.
      </>
    ),
  },
  {
    q: "Can I use bkstr with [agent X]?",
    a: (
      <>
        If the agent can read files from disk, yes. We document Claude
        Code, Cursor, Cline, and Aider explicitly above. For anything else,
        the pattern is the same: fetch the files JSON, write each entry to
        wherever the agent expects on-disk content (its{" "}
        <em>rules folder</em>, <em>skills directory</em>,{" "}
        <em>project root</em>, whatever the docs call it), and reference it
        from your agent&apos;s usual interface.
      </>
    ),
  },
  {
    q: "How do book versions work?",
    a: (
      <>
        Every book and skill has a version number — v1, v2, v3 — and the
        files endpoint returns the latest by default. Older versions are
        addressable via the{" "}
        <code className="font-mono">?version=</code> query param. Authors
        commit to versioning discipline; breaking changes bump the major,
        copy fixes don&apos;t. Your purchase covers all future versions of
        the title you bought — re-fetch any time the publisher ships an
        update.
      </>
    ),
  },
  {
    q: "What if my API key leaks?",
    a: (
      <>
        Revoke it from{" "}
        <Link
          href="/dashboard/api-keys"
          className="text-ink underline decoration-rule hover:decoration-ink"
        >
          /dashboard/api-keys
        </Link>
        {" "}and issue a new one. Keys are hash-stored — bkstr never sees
        the plaintext after issuance, so a leak&apos;s blast radius is
        scoped to fetch access for keys that haven&apos;t been revoked. The
        revoke is immediate; any agent still holding the old key gets a 401
        on next fetch.
      </>
    ),
  },
  {
    q: "How are books different from prompts?",
    a: (
      <>
        A prompt is a single instruction you paste into a chat. A book is a
        curated bundle of files — versioned, paid-for, hash-stored — that
        your agent reads or installs as a durable artifact. Books carry
        their own chapter structure, sample inputs, and (for skills)
        executable scaffolding. The shorthand: a prompt is a sentence; a
        book is a chapter.
      </>
    ),
  },
  {
    q: "Is bkstr a subscription?",
    a: (
      <>
        No. Each book or skill is a one-time purchase, billed through
        Stripe. Your access doesn&apos;t expire and re-fetches don&apos;t
        meter — pay once, fetch the latest version any time, forever.
        There&apos;s no plan tier, no seat math, and no auto-renewal.
      </>
    ),
  },
];

function FaqSection() {
  return (
    <section id="faq" className={`${CONTAINER} pt-20 pb-20 scroll-mt-16`}>
      <SectionRule label="§ FAQ" rightLabel={`${FAQ.length} QUESTIONS`} className="my-0" />

      <div className="mt-12 max-w-[68ch]">
        {FAQ.map((entry, i) => (
          <details
            key={entry.q}
            className={
              "group py-5 " +
              (i < FAQ.length - 1 ? "border-b border-rule" : "")
            }
          >
            <summary className="cursor-pointer list-none flex items-start gap-4 text-ink font-serif text-[19px] leading-[1.35] tracking-tight">
              {/* PR 9 a11y pattern: explicit chevron + accessible toggle.
                  The chevron rotates via group-open: marker so it stays
                  unambiguously expanded/collapsed. */}
              <span
                aria-hidden
                className="font-mono text-saffron-dk text-[14px] mt-1 transition-transform group-open:rotate-90 select-none"
              >
                ▸
              </span>
              <span>{entry.q}</span>
            </summary>
            <div className="text-ink-2 text-[15.5px] leading-[1.65] mt-3 ml-7">
              {entry.a}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// CTA — single focused close
// ─────────────────────────────────────────────────────────────────────────

function CtaSection() {
  return (
    <section className="bg-ink text-paper">
      <div className={`${CONTAINER} py-20 text-center`}>
        <Eyebrow className="text-paper-3">§ READY?</Eyebrow>
        <h2 className="font-serif text-[clamp(40px,5.5vw,60px)] leading-[1.05] tracking-display text-paper mt-5 mb-8 m-0">
          Start with <em className="italic">one</em> book
          <span className="text-saffron">.</span>
        </h2>
        <Link
          href="/storefront"
          className="inline-flex items-center justify-center px-7 py-3.5 text-[15px] font-medium font-sans bg-paper text-ink hover:bg-paper-2 transition-colors rounded-none"
        >
          Browse the catalog →
        </Link>
      </div>
    </section>
  );
}
