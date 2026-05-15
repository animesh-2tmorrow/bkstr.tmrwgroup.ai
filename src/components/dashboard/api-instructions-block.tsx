import Link from "next/link";
import { prisma } from "@/lib/db";
import { Eyebrow } from "@/components/design";

// Phase 4 Stream C — post-purchase API instructions block.
// Server component, rendered on /dashboard/purchase/success and inside the
// Library Active rows (collapsed in a <details>). Shows the buyer the
// real curl shape for fetching their content programmatically.
//
// redesign(10) Phase 2 — extended to be kind-aware (book vs skill) and to
// lead with the files-endpoint (GET /api/{books|skills}/<slug>/files) as
// the primary curl. The Q&A endpoint (POST /api/agent/fetch) stays in the
// component for books only, collapsed as an "advanced" disclosure. Per
// operator decision 7.2, both the library-row disclosure (this block) and
// /dashboard/docs surface the Q&A endpoint — the docs link from the
// detail-page Get Started panel completes that pairing.
//
// PROPS — the canonical signature (Phase 2+) is:
//   { kind, itemId, itemSlug, subscriberId, apiKey?, compact? }
// where apiKey may be { prefix, name } | null. When apiKey is undefined
// (the LEGACY call shape from /dashboard/library + /dashboard/purchase/
// success), this component does an internal `prisma.subscriberApiKey`
// lookup using subscriberId — preserving the existing behavior so those
// callers don't need to change in Phase 2.
//
// LEGACY ALIASES — to keep Phase 2 surgical, this component still accepts
// `bookId` + `bookSlug` from the original signature. They map to itemId +
// itemSlug when the new fields are absent. Phase 3 migrates callers and
// deletes the aliases. Default `kind = "book"` keeps the legacy callers
// rendering the books-side curl.

const ENDPOINT_HOST = "https://bkstr.tmrwgroup.ai";

type ApiKeyInput = { prefix: string; name?: string } | null;

type Props = {
  // New (Phase 2+) — canonical signature
  kind?: "book" | "skill";
  itemId?: string;
  itemSlug?: string;
  apiKey?: ApiKeyInput;

  // Legacy aliases — used by /dashboard/library + /dashboard/purchase/success
  // until Phase 3 migrates them. Either pair (item* OR book*) must be passed.
  bookId?: string;
  bookSlug?: string;

  // Common
  subscriberId: string | null;
  compact?: boolean;
};

function buildFilesCurl(kind: "book" | "skill", slug: string, maskedKey: string | null): string {
  const path = kind === "book" ? "books" : "skills";
  return `curl -H "Authorization: Bearer ${maskedKey ?? "<your-api-key>"}" \\
  ${ENDPOINT_HOST}/api/${path}/${slug}/files`;
}

function buildQACurl(itemId: string, maskedKey: string | null): string {
  // Q&A endpoint is books-only by construction (skills are file-install,
  // not Q&A). The body still keys on `book_id` (UUID, not slug) per the
  // existing /api/agent/fetch contract.
  return `curl -N -X POST ${ENDPOINT_HOST}/api/agent/fetch \\
  -H "Authorization: Bearer ${maskedKey ?? "<your-api-key>"}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "book_id": "${itemId}",
    "query": "<your question about this book>"
  }'`;
}

export async function ApiInstructionsBlock(props: Props) {
  // Resolve the legacy → canonical prop names.
  const kind: "book" | "skill" = props.kind ?? "book";
  const itemId = props.itemId ?? props.bookId;
  const itemSlug = props.itemSlug ?? props.bookSlug;
  const compact = props.compact ?? false;
  if (!itemId || !itemSlug) {
    // Defensive — render nothing rather than throw if a caller forgot to
    // pass either pair. This surfaces in dev as a missing block; better
    // than a runtime crash for a publisher viewing a half-staged record.
    return null;
  }

  // API-key resolution. Three sources, in order:
  //   1. Explicit `apiKey` prop (Phase 2 detail-page caller passes this).
  //   2. Internal lookup using subscriberId (legacy callers — preserved).
  //   3. null → render "Generate an API key first" link.
  // The `apiKey === undefined` case is the legacy path; `apiKey === null`
  // is the explicit-no-key case (caller already determined the user has
  // no active key).
  let resolved: ApiKeyInput = null;
  if (props.apiKey !== undefined) {
    resolved = props.apiKey;
  } else if (props.subscriberId) {
    const row = await prisma.subscriberApiKey.findFirst({
      where: { subscriberId: props.subscriberId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: { keyPrefix: true, name: true },
    });
    resolved = row ? { prefix: row.keyPrefix, name: row.name } : null;
  }

  // Mask: first 8 chars + ellipsis + last 4 of the prefix. keyPrefix is
  // bks_ + 8 random chars (12 total) so this collapses to `bks_xxxx…wxyz`.
  // The full plaintext key is never available here (hash-only storage per
  // SubscriberApiKey schema); masking the prefix is purely an anti-shoulder-
  // surf affordance for screen-share contexts.
  const maskedKey = resolved
    ? `${resolved.prefix.slice(0, 8)}…${resolved.prefix.slice(-4)}`
    : null;

  const filesCurl = buildFilesCurl(kind, itemSlug, maskedKey);
  const qaCurl = kind === "book" ? buildQACurl(itemId, maskedKey) : null;

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
          <Eyebrow>§ INTEGRATION · CURL</Eyebrow>
          <h2 className="font-serif text-[22px] tracking-display text-ink mt-2 mb-1">
            {kind === "book"
              ? "Use this book via the API"
              : "Install this skill via the API"}
          </h2>
          <p className="text-ink-3 text-xs">
            {kind === "book"
              ? "Fetch the book's raw chapter files for your agent. The Q&A endpoint stays available below for grounded-answer use cases."
              : "Fetch the skill's files for installation into your agent."}
          </p>
        </div>
      )}

      {/* Identity / metadata block */}
      <div>
        <Eyebrow>{kind === "book" ? "BOOK" : "SKILL"}</Eyebrow>
        <div className="font-serif text-[15px] text-ink mt-1.5">{itemSlug}</div>
      </div>

      {/* API key block */}
      <div>
        <Eyebrow>API KEY</Eyebrow>
        {resolved ? (
          <div className="space-y-1 mt-1.5">
            <div className="font-mono text-[12px] text-ink">
              {maskedKey}{" "}
              <span className="text-ink-4">
                (masked — full secret shown only at issuance)
              </span>
            </div>
            <Link
              href="/dashboard/api-keys"
              className="font-mono text-[11px] tracking-eyebrow uppercase text-ink underline-offset-2 underline hover:no-underline"
            >
              Manage keys →
            </Link>
          </div>
        ) : (
          <div className="space-y-1 mt-1.5">
            <div className="text-xs text-ink-2">No active API key.</div>
            <Link
              href="/dashboard/api-keys"
              className="font-mono text-[11px] tracking-eyebrow uppercase text-ink underline-offset-2 underline hover:no-underline"
            >
              Generate an API key first →
            </Link>
          </div>
        )}
      </div>

      {/* Primary curl — files endpoint. Always shown, regardless of kind. */}
      <div>
        <Eyebrow>FETCH FILES</Eyebrow>
        <pre className="font-mono text-[12px] bg-paper-2 border border-rule p-3 overflow-x-auto whitespace-pre text-ink mt-1.5">
          {filesCurl}
        </pre>
        <p className="text-xs text-ink-3 mt-2">
          {kind === "book"
            ? "Returns JSON with the book's chapters (path + raw content + sha256). Write the content fields to disk under your agent's skills directory, or read them inline."
            : "Returns JSON with the skill's files (path + raw content + sha256). Write the content fields to disk under your agent's skills directory."}
        </p>
      </div>

      {/* Advanced — Q&A endpoint. Books only. Collapsed by default. */}
      {qaCurl && (
        <details className="group">
          <summary className="cursor-pointer font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 hover:text-ink list-none flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block transition-transform group-open:rotate-90"
            >
              ▸
            </span>
            Q&A endpoint (advanced)
          </summary>
          <div className="mt-3 space-y-2">
            <p className="text-xs text-ink-3">
              POST a question instead of fetching files. The server fetches
              the book content, hands it to Bedrock with your question as
              context, and streams back a grounded answer. Useful when you
              want a Q&A surface anchored to book text rather than the raw
              chapter files.
            </p>
            <pre className="font-mono text-[12px] bg-paper-2 border border-rule p-3 overflow-x-auto whitespace-pre text-ink">
              {qaCurl}
            </pre>
            <p className="text-xs text-ink-3">
              The <code className="font-mono text-ink-2">-N</code> flag
              disables curl&apos;s output buffering so the SSE stream
              surfaces incrementally. <code className="font-mono text-ink-2">book_id</code>{" "}
              is a UUID (the slug-based form is not supported on this
              endpoint).
            </p>
          </div>
        </details>
      )}
    </div>
  );
}
