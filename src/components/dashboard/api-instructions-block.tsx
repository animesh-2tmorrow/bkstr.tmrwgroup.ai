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

// The one-liner install command. Free → anonymous; paid → Bearer token via
// the $BKSTR_KEY env var (the literal env var, never an inline key value).
function buildInstallCommand(slug: string, isFree: boolean): string {
  const url = `${ENDPOINT_HOST}/api/install/${slug}`;
  return isFree
    ? `curl -sL ${url} | tar xz -C ~/.claude/skills/`
    : `curl -sL -H "Authorization: Bearer $BKSTR_KEY" ${url} | tar xz -C ~/.claude/skills/`;
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
  const installCmd = buildInstallCommand(itemSlug, isFree);
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
        <pre className="font-mono text-[12px] bg-paper-2 border border-rule p-3 overflow-x-auto whitespace-pre text-ink mt-1.5">
          {installCmd}
        </pre>
        {isFree ? (
          <p className="text-xs text-ink-3 mt-2">
            This {kind} is free — no API key required. The bundle unpacks to{" "}
            <code className="font-mono text-ink-2">
              ~/.claude/skills/{itemSlug}/
            </code>
            ; other agents follow their own skills-directory convention.
          </p>
        ) : (
          <p className="text-xs text-ink-3 mt-2">
            Export your bkstr API key as{" "}
            <code className="font-mono text-ink-2">$BKSTR_KEY</code> before
            running this.{" "}
            <Link
              href="/dashboard/api-keys"
              className="text-ink underline underline-offset-2 hover:no-underline"
            >
              {hasKey ? "Manage keys →" : "Create an API key →"}
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
            <pre className="font-mono text-[12px] bg-paper-2 border border-rule p-3 overflow-x-auto whitespace-pre text-ink">
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
              <pre className="font-mono text-[12px] bg-paper-2 border border-rule p-3 overflow-x-auto whitespace-pre text-ink">
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
