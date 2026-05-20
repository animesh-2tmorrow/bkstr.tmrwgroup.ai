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
// MCP — expanded "understand and connect" tab. Routes onward to the
// schema-level reference at /dashboard/docs/mcp. Six sections in order:
// (1) what MCP is / why use it, (2) the two modes, (3) setup for all
// three clients, (4) the seven tools plain overview, (5) a first-call
// walkthrough, (6) link out to the docs page.
// ─────────────────────────────────────────────────────────────────────────

function MCPTab() {
  return (
    <section id="mcp" className={`${CONTAINER} pt-20 pb-20 scroll-mt-16`}>
      <SectionRule
        label="§ MCP · AGENT-NATIVE ACCESS"
        rightLabel="HOSTED · 7 TOOLS"
        className="my-0"
      />

      {/* 1. What MCP is and why you'd use it */}
      <div className="mt-10 max-w-[64ch]">
        <h3 className="font-serif font-normal text-[clamp(28px,3.5vw,40px)] leading-[1.1] tracking-display text-ink m-0 mb-6">
          Your agent reads bkstr <em className="italic">in-conversation</em>.
        </h3>
        <p className="text-[16.5px] text-ink-2 leading-[1.65] mt-0 mb-5">
          The Model Context Protocol — MCP — is the open standard hosts
          like Claude Code, Cursor, and Codex CLI use to call tools from
          inside a model turn. bkstr runs a hosted MCP server at{" "}
          <code className="font-mono text-[0.9em] bg-paper-2 px-1">
            https://mcp.bkstr.tmrwgroup.ai/mcp
          </code>
          . Point a compatible client at that URL and seven tools appear in
          your agent&apos;s tool list.
        </p>
        <p className="text-[16.5px] text-ink-2 leading-[1.65] m-0 mb-5">
          The agent can then search the catalog and load owned content
          mid-conversation, without anyone downloading a tarball, pasting a
          curl command, or copying chapter text into the chat. Ask{" "}
          <em>&ldquo;what books are on bkstr about agents?&rdquo;</em> and
          the model picks the right tool, runs it against bkstr, and reads
          the result back to itself.
        </p>
        <p className="text-[16.5px] text-ink-2 leading-[1.65] m-0">
          The server is shared infrastructure — nothing to install, nothing
          to host. The curl and CLI install paths from the Agent Developers
          tab still work; MCP is one more shape on top of the same
          endpoints, not a replacement.
        </p>
      </div>

      {/* 2. The two modes */}
      <div className="mt-16">
        <SectionRule
          label="§ TWO MODES"
          rightLabel="NO KEY · BEARER KEY"
          className="my-0"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-10">
          <ModeCard
            mode="ANONYMOUS"
            pillLabel="No key"
            pillVariant="neutral"
            title="Browse the catalog."
            body={
              <>
                Connect with no header at all and four tools appear:
                catalog search, item detail, popular items, and publisher
                profiles. Works immediately for any visitor — no signup,
                no key, no dashboard round-trip. Good for catalog
                discovery and one-off questions about what bkstr carries.
              </>
            }
          />
          <ModeCard
            mode="AUTHENTICATED"
            pillLabel="Bearer key"
            pillVariant="status-ok"
            title="Read what you own."
            body={
              <>
                Attach an{" "}
                <code className="font-mono text-ink-2">
                  Authorization: Bearer bks_…
                </code>{" "}
                header on every request and three more tools unlock:
                library listing, inline loading of owned books and skills,
                and grounded Q&amp;A against an owned book. The key is the
                same{" "}
                <code className="font-mono text-ink-2">bks_</code> key the
                install endpoint and the CLI already use — create one at{" "}
                <Link
                  href="/dashboard/api-keys"
                  className="text-ink underline decoration-rule hover:decoration-ink"
                >
                  /dashboard/api-keys
                </Link>
                .
              </>
            }
          />
        </div>
      </div>

      {/* 3. Setup for all three clients */}
      <div className="mt-16">
        <SectionRule
          label="§ SETUP"
          rightLabel="3 CLIENTS"
          className="my-0"
        />
        <p className="text-[15px] text-ink-2 leading-[1.65] mt-8 max-w-[64ch]">
          The endpoint is{" "}
          <code className="font-mono text-ink-2 text-[0.9em]">
            https://mcp.bkstr.tmrwgroup.ai/mcp
          </code>{" "}
          and the transport is Streamable HTTP — the modern MCP transport,
          not stdio. Anonymous tools work with no header; authenticated
          tools need a Bearer key on every request. Each client below has
          both forms.
        </p>

        <ClientSetup
          name="CLAUDE CODE"
          pillLabel="claude mcp CLI"
          summary={
            <>
              Add the server once with the{" "}
              <code className="font-mono text-ink-2">claude mcp</code> CLI.{" "}
              <code className="font-mono text-ink-2">--transport http</code>{" "}
              picks Streamable HTTP;{" "}
              <code className="font-mono text-ink-2">--header</code> attaches
              the Bearer key. Inside Claude Code, type{" "}
              <code className="font-mono text-ink-2">/mcp</code> to see the
              connected server and its tools.
            </>
          }
          snippet={`# Anonymous — only the four browse tools will work
claude mcp add bkstr --transport http https://mcp.bkstr.tmrwgroup.ai/mcp

# Authenticated — paste your key once; Claude Code stores it
claude mcp add bkstr --transport http https://mcp.bkstr.tmrwgroup.ai/mcp \\
  --header "Authorization: Bearer $BKSTR_KEY"`}
        />

        <ClientSetup
          name="CURSOR"
          pillLabel="mcp.json"
          summary={
            <>
              Cursor reads MCP servers from{" "}
              <code className="font-mono text-ink-2">~/.cursor/mcp.json</code>{" "}
              (global) or{" "}
              <code className="font-mono text-ink-2">.cursor/mcp.json</code>{" "}
              inside a project. Drop the{" "}
              <code className="font-mono text-ink-2">headers</code> block to
              use the server anonymously. Restart Cursor after saving the
              file; the{" "}
              <code className="font-mono text-ink-2">bkstr</code> server
              shows up in the MCP panel with its tool list.
            </>
          }
          snippet={`{
  "mcpServers": {
    "bkstr": {
      "url": "https://mcp.bkstr.tmrwgroup.ai/mcp",
      "headers": {
        "Authorization": "Bearer bks_your_key_here"
      }
    }
  }
}`}
        />

        <ClientSetup
          name="CODEX CLI"
          pillLabel="config.toml"
          summary={
            <>
              Codex reads{" "}
              <code className="font-mono text-ink-2">~/.codex/config.toml</code>.
              Add an{" "}
              <code className="font-mono text-ink-2">[mcp_servers.bkstr]</code>{" "}
              block — omit the{" "}
              <code className="font-mono text-ink-2">[…headers]</code> table
              for anonymous use.{" "}
              <code className="font-mono text-ink-2">codex mcp list</code>{" "}
              confirms the server is registered.
            </>
          }
          snippet={`[mcp_servers.bkstr]
url = "https://mcp.bkstr.tmrwgroup.ai/mcp"

[mcp_servers.bkstr.headers]
Authorization = "Bearer bks_your_key_here"`}
        />

        <p className="text-ink-3 text-[13px] leading-[1.65] mt-8 max-w-[68ch]">
          Anything else that speaks Streamable HTTP MCP works the same way:
          hand it the URL above; for authenticated tools, attach an{" "}
          <code className="font-mono text-ink-2">Authorization: Bearer bks_…</code>{" "}
          header. The server is stateless — no session handshake or
          persistent connection is required.
        </p>
      </div>

      {/* 4. The seven tools — plain overview */}
      <div className="mt-16">
        <SectionRule
          label="§ SEVEN TOOLS"
          rightLabel="4 ANON · 3 KEYED"
          className="my-0"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mt-10">
          <ToolGroup
            title="Anonymous"
            blurb="No key, no header. Work for any visitor."
            tools={[
              { name: "search_catalog", line: "Free-text search of the marketplace catalog." },
              { name: "get_item", line: "Full public detail for one item by slug." },
              { name: "get_popular", line: "Most-purchased items, popularity bucketed." },
              { name: "get_publisher", line: "A publisher's profile and their full active catalog." },
            ]}
          />
          <ToolGroup
            title="Authenticated"
            blurb={
              <>
                Need an{" "}
                <code className="font-mono text-ink-2">
                  Authorization: Bearer bks_…
                </code>{" "}
                header on every call.
              </>
            }
            tools={[
              { name: "my_library", line: "Every book and skill the authenticated subscriber owns." },
              { name: "load_item", line: "Inline chapters (book) or inline files (skill) the subscriber owns." },
              { name: "ask_book", line: "Streamed, source-grounded Q&A against one owned book." },
            ]}
          />
        </div>
        <p className="text-ink-3 text-[13px] leading-[1.65] mt-10 max-w-[68ch]">
          Per-tool input and output schemas — and what each field means —
          live on the{" "}
          <Link
            href="/dashboard/docs/mcp"
            className="text-ink underline decoration-rule hover:decoration-ink"
          >
            MCP server reference
          </Link>
          .
        </p>
      </div>

      {/* 5. Your first call — short onboarding walkthrough */}
      <div className="mt-16">
        <SectionRule
          label="§ YOUR FIRST CALL"
          rightLabel="5 STEPS"
          className="my-0"
        />
        <ol className="mt-10 max-w-[68ch] list-none p-0 m-0 space-y-0">
          <WalkStep
            n="01"
            title="Add the server anonymously"
            body={
              <>
                Run the anonymous{" "}
                <code className="font-mono text-ink-2">claude mcp add</code>{" "}
                line from above (or its Cursor / Codex equivalent). Type{" "}
                <code className="font-mono text-ink-2">/mcp</code> in Claude
                Code — the{" "}
                <code className="font-mono text-ink-2">bkstr</code> server
                appears with seven tools listed. The authenticated tools
                will show errors until you add a key in step 4.
              </>
            }
          />
          <WalkStep
            n="02"
            title="Search the catalog"
            body={
              <>
                Ask the agent <em>&ldquo;what books are on bkstr about
                agents?&rdquo;</em>. It picks{" "}
                <code className="font-mono text-ink-2">search_catalog</code>{" "}
                and returns real catalog rows with slugs, titles, prices,
                and a{" "}
                <code className="font-mono text-ink-2">storefront_url</code>{" "}
                you can use to buy.
              </>
            }
          />
          <WalkStep
            n="03"
            title="Get an API key"
            body={
              <>
                Visit{" "}
                <Link
                  href="/dashboard/api-keys"
                  className="text-ink underline decoration-rule hover:decoration-ink"
                >
                  /dashboard/api-keys
                </Link>
                , click{" "}
                <strong className="font-semibold text-ink">
                  Create new key
                </strong>
                , give it a label, copy the{" "}
                <code className="font-mono text-ink-2">bks_</code> value.
                Keys are shown once — copy it now.
              </>
            }
          />
          <WalkStep
            n="04"
            title="Reconnect, authenticated"
            body={
              <>
                Re-run{" "}
                <code className="font-mono text-ink-2">claude mcp add</code>{" "}
                with the{" "}
                <code className="font-mono text-ink-2">--header</code> flag
                carrying your key. Claude Code stores it and attaches it on
                every request from now on. The{" "}
                <code className="font-mono text-ink-2">bkstr</code> entry
                in <code className="font-mono text-ink-2">/mcp</code>{" "}
                doesn&apos;t change visually — the difference shows up when
                you call a keyed tool.
              </>
            }
          />
          <WalkStep
            n="05"
            title="List and load"
            body={
              <>
                Ask <em>&ldquo;what&apos;s in my library?&rdquo;</em> — the
                agent picks{" "}
                <code className="font-mono text-ink-2">my_library</code>.
                Pick something and ask <em>&ldquo;load it&rdquo;</em> —
                the agent picks{" "}
                <code className="font-mono text-ink-2">load_item</code> and
                the content arrives inline (chapters for a book, files for
                a skill). The agent reads what it loaded, where it loaded
                it.
              </>
            }
          />
        </ol>
        <p className="text-ink-3 text-[13px] leading-[1.65] mt-10 max-w-[68ch]">
          If a step fails, the reference page has a troubleshooting
          walk-through covering each realistic failure mode and what to
          do about it.
        </p>
      </div>

      {/* 6. Link out to the full reference */}
      <div className="mt-16 border border-rule bg-paper-2 p-8">
        <Eyebrow className="block mb-4">§ FULL REFERENCE</Eyebrow>
        <p className="text-ink-2 text-[15px] leading-[1.65] mt-0 mb-5 max-w-[64ch]">
          Per-tool input and output schemas, the complete error-code table,
          rate-limit specifics, the{" "}
          <code className="font-mono">ask_book</code> kill-switch contract,
          and the full troubleshooting walk-through all live on one page —
          the schema-level reference this tab deliberately stops short of.
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

// ─── helpers for the MCP tab ──────────────────────────────────────────

function ModeCard({
  mode,
  pillLabel,
  pillVariant,
  title,
  body,
}: {
  mode: string;
  pillLabel: string;
  pillVariant: "neutral" | "status-ok";
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div className="border-t-2 border-ink pt-5">
      <div className="flex items-baseline gap-3 mb-3">
        <Eyebrow>{mode}</Eyebrow>
        <Pill variant={pillVariant}>{pillLabel}</Pill>
      </div>
      <h4 className="font-serif font-normal text-[22px] leading-[1.2] mt-1 mb-3 tracking-tight text-ink">
        {title}
      </h4>
      <p className="text-ink-2 text-[14.5px] leading-[1.6] m-0">
        {body}
      </p>
    </div>
  );
}

function ClientSetup({
  name,
  pillLabel,
  summary,
  snippet,
}: {
  name: string;
  pillLabel: string;
  summary: React.ReactNode;
  snippet: string;
}) {
  return (
    <div className="mt-10 pt-8 border-t border-rule first-of-type:border-t-2 first-of-type:border-ink">
      <div className="flex items-baseline gap-3 mb-3">
        <Eyebrow>{name}</Eyebrow>
        <Pill variant="neutral">{pillLabel}</Pill>
      </div>
      <p className="text-ink-2 text-[15px] leading-[1.65] mb-5 max-w-[64ch]">
        {summary}
      </p>
      <pre className="font-mono text-[12.5px] bg-ink text-paper p-6 overflow-x-auto leading-[1.6] m-0">
        {snippet}
      </pre>
    </div>
  );
}

function ToolGroup({
  title,
  blurb,
  tools,
}: {
  title: string;
  blurb: React.ReactNode;
  tools: ReadonlyArray<{ name: string; line: string }>;
}) {
  return (
    <div className="border-t-2 border-ink pt-5">
      <Eyebrow>{title.toUpperCase()}</Eyebrow>
      <p className="text-ink-3 text-[13px] leading-[1.55] mt-2 mb-4">
        {blurb}
      </p>
      <ul className="list-none p-0 m-0 space-y-3">
        {tools.map((t) => (
          <li key={t.name}>
            <code className="font-mono text-[13px] text-ink">{t.name}</code>
            <span className="text-ink-2 text-[14px] leading-[1.6] ml-2">
              — {t.line}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WalkStep({
  n,
  title,
  body,
}: {
  n: string;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <li className="py-5 border-b border-rule last:border-b-0">
      <div className="grid grid-cols-[56px_1fr] gap-4 items-baseline">
        <div className="font-mono text-xs tracking-[2px] text-saffron-dk">
          {n}
        </div>
        <div>
          <h4 className="font-serif font-normal text-[20px] leading-[1.2] tracking-tight text-ink mt-0 mb-2">
            {title}
          </h4>
          <p className="text-ink-2 text-[15px] leading-[1.65] m-0">
            {body}
          </p>
        </div>
      </div>
    </li>
  );
}
