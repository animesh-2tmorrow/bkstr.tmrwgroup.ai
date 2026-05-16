import Link from "next/link";
import { Eyebrow } from "@/components/design";

// Post-purchase / owned-item API instructions block.
//
// Move 1 Phase 2b — rewritten to lead with the one-liner install endpoint
// (/api/install/<slug>). Primary command is the curl | tar xz pipeline;
// the older per-file JSON endpoint (/api/{books,skills}/<slug>/files) and
// the books-only Q&A endpoint are demoted into a collapsed "Advanced ·
// programmatic access" disclosure.
//
// Free items install anonymously (no key); paid items use a Bearer token
// shown as the $BKSTR_KEY env var (never the inline key value).
//
// Rendered by: /dashboard/library rows (compact), /dashboard/purchase/
// success, and the /storefront/[slug] owned-state §GET STARTED panel.
//
// The Phase-2 legacy prop aliases (bookId/bookSlug) and the internal
// api-key Prisma lookup are gone — the canonical signature below is the
// only shape, callers resolve everything. `subscriberId` is retained in
// the signature for caller-contract stability; this presentational
// component no longer reads it.

const ENDPOINT_HOST = "https://bkstr.tmrwgroup.ai";

export type ApiInstructionsBlockProps = {
  kind: "book" | "skill";
  itemId: string;
  itemSlug: string;
  subscriberId: string;
  /** The subscriber's API key prefix; "" when they have none / item is free. */
  apiKey: string;
  /** Free items install anonymously; paid items need a Bearer token. */
  isFree: boolean;
  compact?: boolean;
};

// The install command, copy-paste-safe on a fresh machine.
//   - `mkdir -p ~/.claude/skills` is prepended so the tar target exists on
//     first run (a fresh Claude Code install doesn't have it).
//   - Free → single self-sufficient line, no auth.
//   - Paid → two lines in ONE block: an `export BKSTR_KEY=…` line above the
//     curl, so copying the whole block sets the env var the curl reads.
//     The export carries the subscriber's key prefix as a personalized
//     starting point (or a generic placeholder when the caller didn't
//     thread a key); the user completes it with their full key, which is
//     hash-stored and never re-shown.
function buildInstallCommand(
  slug: string,
  isFree: boolean,
  apiKey: string,
): string {
  const url = `${ENDPOINT_HOST}/api/install/${slug}`;
  if (isFree) {
    return `mkdir -p ~/.claude/skills && curl -sL ${url} | tar xz -C ~/.claude/skills/`;
  }
  const keyValue = apiKey !== "" ? apiKey : "bks_your_key_here";
  return `export BKSTR_KEY=${keyValue}
mkdir -p ~/.claude/skills && curl -sL -H "Authorization: Bearer $BKSTR_KEY" ${url} | tar xz -C ~/.claude/skills/`;
}

// Advanced path — the per-file JSON endpoint. Kept documented but demoted.
function buildFilesCurl(kind: "book" | "skill", slug: string): string {
  const path = kind === "book" ? "books" : "skills";
  return `curl -H "Authorization: Bearer $BKSTR_KEY" \\
  ${ENDPOINT_HOST}/api/${path}/${slug}/files`;
}

// Advanced path — books-only Q&A endpoint. body keys on book_id (UUID).
function buildQACurl(itemId: string): string {
  return `curl -N -X POST ${ENDPOINT_HOST}/api/agent/fetch \\
  -H "Authorization: Bearer $BKSTR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "book_id": "${itemId}",
    "query": "<your question about this book>"
  }'`;
}

export function ApiInstructionsBlock({
  kind,
  itemId,
  itemSlug,
  apiKey,
  isFree,
  compact = false,
}: ApiInstructionsBlockProps) {
  const installCmd = buildInstallCommand(itemSlug, isFree, apiKey);
  const filesCurl = buildFilesCurl(kind, itemSlug);
  const qaCurl = kind === "book" ? buildQACurl(itemId) : null;
  const hasKey = apiKey !== "";

  return (
    <div
      className={
        compact
          ? "border border-rule bg-paper-2 p-4 space-y-4"
          : "bg-paper border border-rule p-6 space-y-5"
      }
    >
      {!compact && (
        <div>
          <Eyebrow>§ INSTALL · ONE COMMAND</Eyebrow>
          <h2 className="font-serif text-[22px] tracking-display text-ink mt-2 mb-1">
            {kind === "book" ? "Install this book" : "Install this skill"}
          </h2>
          <p className="text-ink-3 text-xs">
            Fetch and unpack the {kind} into your agent&apos;s skills
            directory with a single command.
          </p>
        </div>
      )}

      {/* Identity */}
      <div>
        <Eyebrow>{kind === "book" ? "BOOK" : "SKILL"}</Eyebrow>
        <div className="font-serif text-[15px] text-ink mt-1.5">{itemSlug}</div>
      </div>

      {/* PRIMARY — the install one-liner. */}
      <div>
        <Eyebrow>INSTALL</Eyebrow>
        <pre className="font-mono text-[12px] bg-paper-2 border border-rule p-3 whitespace-pre-wrap break-all text-ink mt-1.5">
          {installCmd}
        </pre>
        {isFree ? (
          <p className="text-xs text-ink-3 mt-2">
            This {kind} is free — no API key required. The command creates{" "}
            <code className="font-mono text-ink-2">~/.claude/skills/</code> if
            it&apos;s missing, then unpacks the bundle into{" "}
            <code className="font-mono text-ink-2">
              ~/.claude/skills/{itemSlug}/
            </code>
            . Copy-paste it as-is.
          </p>
        ) : (
          <p className="text-xs text-ink-3 mt-2">
            Copy <strong className="text-ink-2">both lines</strong> together —
            the <code className="font-mono text-ink-2">export</code> sets{" "}
            <code className="font-mono text-ink-2">$BKSTR_KEY</code>, which the
            curl reads. Replace{" "}
            <code className="font-mono text-ink-2">
              {hasKey ? apiKey : "bks_your_key_here"}
            </code>{" "}
            with your full key.{" "}
            <Link
              href="/dashboard/api-keys"
              className="text-ink underline underline-offset-2 hover:no-underline"
            >
              {hasKey ? "Manage keys →" : "Create or find your key →"}
            </Link>
          </p>
        )}
      </div>

      {/* ADVANCED — the per-file JSON endpoint + (books) Q&A. Collapsed. */}
      <details className="group">
        <summary className="cursor-pointer font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 hover:text-ink list-none flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block transition-transform group-open:rotate-90"
          >
            ▸
          </span>
          Advanced · programmatic access
        </summary>
        <div className="mt-3 space-y-4">
          <div>
            <p className="text-xs text-ink-3 mb-2">
              Prefer raw JSON over a tarball?{" "}
              <code className="font-mono text-ink-2">
                GET /api/{kind === "book" ? "books" : "skills"}/{itemSlug}/files
              </code>{" "}
              returns each file as{" "}
              <code className="font-mono text-ink-2">path</code> +{" "}
              <code className="font-mono text-ink-2">content</code> +{" "}
              <code className="font-mono text-ink-2">sha256</code> — write the
              content fields to disk yourself.
            </p>
            <pre className="font-mono text-[12px] bg-paper-2 border border-rule p-3 whitespace-pre-wrap break-all text-ink">
              {filesCurl}
            </pre>
          </div>

          {qaCurl && (
            <div>
              <p className="text-xs text-ink-3 mb-2">
                Q&amp;A endpoint (books only) — POST a question instead of
                fetching files. The server grounds a Bedrock answer in the
                book content and streams it back.
              </p>
              <pre className="font-mono text-[12px] bg-paper-2 border border-rule p-3 whitespace-pre-wrap break-all text-ink">
                {qaCurl}
              </pre>
              <p className="text-xs text-ink-3 mt-2">
                The <code className="font-mono text-ink-2">-N</code> flag
                disables curl&apos;s buffering so the SSE stream surfaces
                incrementally.{" "}
                <code className="font-mono text-ink-2">book_id</code> is a
                UUID (the slug form is not supported on this endpoint).
              </p>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
