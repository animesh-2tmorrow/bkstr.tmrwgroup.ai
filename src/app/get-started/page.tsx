// get-started — public onboarding page.
//
// Editorial three-tab layout (Subscribers / Agent Developers / MCP). The
// audience-neutral content — Hero, What-is-bkstr, FAQ, CTA — stays on this
// server page; the audience-specific content lives inside the client tabs
// component so a tab switch is purely client-side with no round-trip.
//
// Phase A's outline locked the structure; Phase B captured the screenshots;
// Phase C turned those into the original single-scroll page; the 2026-05-20
// pass split the install / agent-dev / MCP content into three tabs so the
// MCP surface has somewhere to land alongside the existing material without
// crowding the subscriber-first narrative.
//
// Aesthetic: editorial, not templated. No fabricated metrics, no synthetic
// testimonials. Existing design tokens only.

import Link from "next/link";
import { Suspense } from "react";
import {
  Masthead,
  MarketingFooter,
  Eyebrow,
  Pill,
  Button,
  SectionRule,
  type MastheadNavItem,
} from "@/components/design";
import { GetStartedTabs } from "./_components/get-started-tabs";

export const metadata = {
  title: "Get started | bkstr",
  description:
    "Buy a book, fetch its files via API, install per your agent's docs — or connect over MCP for agent-native access. Three paths in.",
};

const NAV: ReadonlyArray<MastheadNavItem> = [
  { label: "Home", href: "/" },
  { label: "Catalog", href: "/storefront" },
  { label: "Get started", href: "/get-started", active: true },
  { label: "Docs", href: "/dashboard/docs" },
  { label: "Log in", href: "/login" },
];

// Container max-width mirrors the original "~1100px container" spec — keeps
// editorial prose at readable measure on wide displays.
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
        {/* Audience-neutral header: the same hero + framing block for every
            visitor, before they pick a track. */}
        <HeroSection />
        <WhatIsBkstrSection />

        {/* Audience-specific content lives behind tabs. <Suspense> wraps the
            client component because useSearchParams (for ?tab=… deep links)
            opts the route out of static prerendering otherwise. */}
        <Suspense fallback={null}>
          <GetStartedTabs />
        </Suspense>

        {/* Audience-neutral footer: FAQ + close CTA apply to every track. */}
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
        skills directory. Or skip the install entirely and connect your
        agent over MCP.
      </p>

      {/* The install command — the curl one-liner and the npm CLI
          equivalent. gif-grep is a free item; the mkdir -p makes the curl
          form copy-paste safely on a fresh machine where ~/.claude/skills/
          doesn't exist yet. */}
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

      <div className="flex gap-2 items-center flex-wrap mt-8">
        <Pill variant="neutral">VOL. 01</Pill>
        <Pill variant="neutral">EST. 2026</Pill>
        <Pill variant="neutral">STRIPE-BILLED · NO SUBSCRIPTION</Pill>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// WHAT IS BKSTR — honesty framing block
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

        <div className="border-l-4 border-saffron-dk bg-paper pl-6 sm:pl-8 pr-6 sm:pr-8 py-7 max-w-[68ch]">
          <p className="text-[17px] text-ink leading-[1.65] m-0">
            <strong className="text-ink font-semibold">What bkstr is.</strong>{" "}
            A catalog of books — bundles of files your AI agent reads. Pay
            once per book. Fetch the files via API, install per your
            agent&apos;s docs, or connect over MCP.
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
            body="Claude Code, Cursor, Cline, Aider — anything that reads files on disk, or anything that speaks MCP."
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
        Code, Cursor, Cline, and Aider explicitly under the Agent
        Developers tab above. For anything else, the pattern is the same:
        fetch the files JSON, write each entry to wherever the agent
        expects on-disk content (its <em>rules folder</em>,{" "}
        <em>skills directory</em>, <em>project root</em>, whatever the
        docs call it), and reference it from your agent&apos;s usual
        interface. Or — if the agent speaks MCP — skip the install path
        entirely and use the MCP tab.
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
