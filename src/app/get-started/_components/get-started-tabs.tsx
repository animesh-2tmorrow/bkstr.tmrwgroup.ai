"use client";

// Three-tab section on /get-started: Subscribers (default), Agent Developers,
// and MCP. The tab UI is a client-side toggle — switching tabs is purely a
// state update, no route change. Deep-linking via `?tab=mcp` is read on
// mount via useSearchParams; tab clicks do not push history (kept tight
// per the dispatch's "don't over-engineer" line).
//
// Subscriber + Agent Developer tab content was lifted verbatim out of the
// original single-scroll get-started page (Phase C). The MCP tab is the
// 2026-05-20 addition — a marketing-toned intro that routes to the full
// reference at /dashboard/docs/mcp.

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Eyebrow, Pill, SectionRule } from "@/components/design";

const CONTAINER = "max-w-[1100px] mx-auto px-6 sm:px-8";

type TabKey = "subscribers" | "agents" | "mcp";

const TABS: ReadonlyArray<{ key: TabKey; label: string; blurb: string }> = [
  { key: "subscribers", label: "Subscribers", blurb: "Sign up, browse, buy, install." },
  { key: "agents", label: "Agent Developers", blurb: "CLI, API, raw JSON." },
  { key: "mcp", label: "MCP", blurb: "Agent-native, mid-conversation." },
];

function isTab(value: string | null): value is TabKey {
  return value === "subscribers" || value === "agents" || value === "mcp";
}

export function GetStartedTabs() {
  // useSearchParams in a client component is a Suspense-boundary participant
  // in Next 15; the parent page.tsx wraps this component in <Suspense>.
  const searchParams = useSearchParams();
  const initialTab: TabKey = (() => {
    const t = searchParams?.get("tab") ?? null;
    return isTab(t) ? t : "subscribers";
  })();
  const [active, setActive] = useState<TabKey>(initialTab);

  return (
    <>
      <section id="tracks" className={`${CONTAINER} pt-20 pb-2 scroll-mt-16`}>
        <SectionRule label="§ TRACKS" rightLabel="PICK YOUR PATH" className="my-0" />

        {/* Tab bar — segmented control, full width on lg+, stacks on small.
            Active tab inverts to ink-background/paper-text to make selection
            unambiguous; matches the editorial high-contrast aesthetic. */}
        <nav
          role="tablist"
          aria-label="Get started, by audience"
          className="mt-10 flex flex-col sm:flex-row border-t border-b border-rule"
        >
          {TABS.map((tab, i) => {
            const isActive = active === tab.key;
            return (
              <button
                key={tab.key}
                role="tab"
                type="button"
                aria-selected={isActive}
                aria-controls={`tabpanel-${tab.key}`}
                id={`tab-${tab.key}`}
                onClick={() => setActive(tab.key)}
                className={
                  "flex-1 text-left px-5 py-5 transition-colors " +
                  (i < TABS.length - 1 ? "sm:border-r border-b sm:border-b-0 border-rule " : "") +
                  (isActive
                    ? "bg-ink text-paper"
                    : "bg-paper hover:bg-paper-2 text-ink")
                }
              >
                <div className={"font-mono text-[11px] tracking-[1.5px] uppercase " + (isActive ? "text-paper-3" : "text-ink-3")}>
                  Track 0{TABS.indexOf(tab) + 1}
                </div>
                <div className="font-serif text-[20px] mt-1.5">{tab.label}</div>
                <div className={"text-[13px] mt-0.5 " + (isActive ? "text-paper-3" : "text-ink-3")}>
                  {tab.blurb}
                </div>
              </button>
            );
          })}
        </nav>
      </section>

      {/* Tab panels — exactly one renders. `hidden` plus conditional render
          keeps off-tab DOM out of layout AND out of the tree (the tabs are
          static content; remounting on switch costs nothing). */}
      <div role="tabpanel" id="tabpanel-subscribers" aria-labelledby="tab-subscribers" hidden={active !== "subscribers"}>
        {active === "subscribers" && <SubscribersTab />}
      </div>
      <div role="tabpanel" id="tabpanel-agents" aria-labelledby="tab-agents" hidden={active !== "agents"}>
        {active === "agents" && <AgentDevelopersTab />}
      </div>
      <div role="tabpanel" id="tabpanel-mcp" aria-labelledby="tab-mcp" hidden={active !== "mcp"}>
        {active === "mcp" && <MCPTab />}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SUBSCRIBERS — the original "THE 3 STEPS" content, unchanged.
// ─────────────────────────────────────────────────────────────────────────

function SubscribersTab() {
  return (
    <section id="steps" className={`${CONTAINER} pt-16 pb-12 scroll-mt-16`}>
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
// AGENT DEVELOPERS — the original "INSTALL · FOR YOUR AGENT" content.
// ─────────────────────────────────────────────────────────────────────────

function AgentDevelopersTab() {
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
// MCP — new tab. Marketing-toned entry point that routes to the full
// reference at /dashboard/docs/mcp.
// ─────────────────────────────────────────────────────────────────────────

function MCPTab() {
  return (
    <section id="mcp" className={`${CONTAINER} pt-20 pb-20 scroll-mt-16`}>
      <SectionRule
        label="§ MCP · AGENT-NATIVE ACCESS"
        rightLabel="HOSTED · 7 TOOLS"
        className="my-0"
      />

      <div className="mt-10 max-w-[64ch]">
        <h3 className="font-serif font-normal text-[clamp(28px,3.5vw,40px)] leading-[1.1] tracking-display text-ink m-0 mb-5">
          Your agent reads bkstr <em className="italic">in-conversation</em>.
        </h3>
        <p className="text-[16.5px] text-ink-2 leading-[1.65] m-0">
          bkstr runs a hosted Model Context Protocol server at{" "}
          <code className="font-mono text-[0.9em] bg-paper-2 px-1">
            https://mcp.bkstr.tmrwgroup.ai/mcp
          </code>
          . Connect Claude Code, Cursor, Codex CLI, or any MCP-compatible
          client, and your agent picks up seven tools for searching the
          catalog and loading owned content — without leaving the
          conversation, without shuttling files to disk.
        </p>
      </div>

      <div className="mt-12">
        <div className="flex items-baseline gap-3 mb-3">
          <Eyebrow>ONE LINE · CLAUDE CODE</Eyebrow>
          <Pill variant="status-ok">Hosted</Pill>
        </div>
        <h4 className="font-serif font-normal text-[24px] leading-[1.15] tracking-tight text-ink mb-4">
          Add the server, get seven tools.
        </h4>
        <pre className="font-mono text-[12.5px] bg-ink text-paper p-6 overflow-x-auto leading-[1.6] m-0">
{`# Authenticated — paste your key once; Claude Code stores it
claude mcp add bkstr --transport http https://mcp.bkstr.tmrwgroup.ai/mcp \\
  --header "Authorization: Bearer $BKSTR_KEY"`}
        </pre>
        <p className="text-ink-3 text-[13px] leading-[1.6] mt-4 mb-0 max-w-[64ch]">
          Cursor and Codex CLI follow the same shape — drop the URL into the
          MCP config block, attach the same{" "}
          <code className="font-mono text-ink-2">Bearer bks_…</code> key in
          the headers, restart the client. The full per-client config — and
          the anonymous form — is in the docs.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-16">
        <Capability
          eyebrow="ANONYMOUS"
          title="Catalog search, instantly."
          body={
            <>
              Four tools work with no key at all:{" "}
              <code className="font-mono text-ink-2">search_catalog</code>,{" "}
              <code className="font-mono text-ink-2">get_item</code>,{" "}
              <code className="font-mono text-ink-2">get_popular</code>,{" "}
              <code className="font-mono text-ink-2">get_publisher</code>.
              Ask the agent <em>&ldquo;what&apos;s on bkstr about
              agents?&rdquo;</em> and it runs a real catalog query against
              prod.
            </>
          }
        />
        <Capability
          eyebrow="OWNED LIBRARY"
          title="Read what you own, in place."
          body={
            <>
              With a <code className="font-mono text-ink-2">bks_</code> key,{" "}
              <code className="font-mono text-ink-2">my_library</code> lists
              every book and skill on your account, and{" "}
              <code className="font-mono text-ink-2">load_item</code> streams
              the contents inline — chapters for a book, files for a skill.
              The agent reads what it loaded, where it loaded it.
            </>
          }
        />
        <Capability
          eyebrow="GROUNDED Q&A"
          title="Ask a book a question."
          body={
            <>
              <code className="font-mono text-ink-2">ask_book</code> proxies
              to the bkstr Q&amp;A endpoint: streamed answers grounded only
              in the book&apos;s content. Books only, owned-only, costed —
              the operator kill-switch lets bkstr disable it without
              redeploy if Bedrock spend spikes.
            </>
          }
        />
        <Capability
          eyebrow="ATTRIBUTION"
          title="Same keys, same identity."
          body={
            <>
              The MCP server reuses the existing{" "}
              <code className="font-mono text-ink-2">bks_</code> API key —
              same key as the curl install, same key as the CLI, validated
              against the same{" "}
              <code className="font-mono text-ink-2">subscriber_api_keys</code>{" "}
              table.{" "}
              <code className="font-mono text-ink-2">ask_book</code> writes
              its{" "}
              <code className="font-mono text-ink-2">fetch_logs</code> row
              attributed to that key, exactly like a direct call to the
              Q&amp;A endpoint. One identity, one budget, one ledger.
            </>
          }
        />
      </div>

      <div className="mt-16 border border-rule bg-paper-2 p-8">
        <Eyebrow className="block mb-4">§ FULL REFERENCE</Eyebrow>
        <p className="text-ink-2 text-[15px] leading-[1.65] mt-0 mb-5 max-w-[64ch]">
          Every client config — Claude Code, Cursor, Codex CLI, anything
          else — plus the full tool inventory, the authentication model,
          rate limits, the kill-switch behaviour, every error code, and a
          troubleshooting walk-through, all in one page:
        </p>
        <Link
          href="/dashboard/docs/mcp"
          className="inline-flex items-center justify-center px-6 py-3 text-[14px] font-medium font-sans bg-ink text-paper hover:bg-ink-2 transition-colors rounded-none"
        >
          MCP server reference →
        </Link>
      </div>
    </section>
  );
}

function Capability({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div className="border-t-2 border-ink pt-5">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h4 className="font-serif font-normal text-[22px] leading-[1.2] mt-3 mb-3 tracking-tight text-ink">
        {title}
      </h4>
      <p className="text-ink-2 text-[14.5px] leading-[1.6] m-0">
        {body}
      </p>
    </div>
  );
}
