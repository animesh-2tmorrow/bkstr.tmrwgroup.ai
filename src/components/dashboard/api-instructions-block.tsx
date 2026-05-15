import Link from "next/link";
import { prisma } from "@/lib/db";
import { Eyebrow } from "@/components/design";

// Phase 4 Stream C — post-purchase API instructions block.
// Server component, rendered on /dashboard/purchase/success and inside the
// Library Active rows (collapsed in a <details>). Shows the buyer the
// book_id UUID + a canonical curl shape, with the API-key branch keyed off
// whether the subscriber has any active SubscriberApiKey row.
//
// The key prefix is masked (first 8 chars from keyPrefix, then "…<last 4>")
// rather than shown in full — keyPrefix is non-secret (it's already on every
// row of /dashboard/api-keys) but masking by default keeps casual screen-
// shares cleaner. The plaintext secret is shown only at issuance per
// SubscriberApiKey's hash-only storage (prisma/schema.prisma:237-253).
//
// The endpoint URL is the production host. Local-dev callers replace it
// with http://localhost:3000 — that's a "your tooling already knows the
// dev URL" affordance and not surfaced here to keep the block one-shape.
//
// bkstr redesign PR 7 — restyled with design tokens. Square corners,
// hairline rules, mono uppercase eyebrows on the field labels.

export async function ApiInstructionsBlock({
  subscriberId,
  bookId,
  bookSlug,
  compact = false,
}: {
  subscriberId: string;
  bookId: string;
  bookSlug?: string;
  compact?: boolean;
}) {
  const activeKey = await prisma.subscriberApiKey.findFirst({
    where: { subscriberId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { keyPrefix: true },
  });

  // Mask: show first 8 chars (the bks_ + 4 of the random portion) then ellipsis
  // then last 4 of the prefix. The keyPrefix column itself is bks_ + 8 random
  // chars (12 total per src/lib/auth/api-key.ts:7), so the mask collapses to
  // `bks_xxxx…wxyz` shape.
  const maskedKey = activeKey
    ? `${activeKey.keyPrefix.slice(0, 8)}…${activeKey.keyPrefix.slice(-4)}`
    : null;

  const curl = `curl -N -X POST https://bkstr.tmrwgroup.ai/api/agent/fetch \\
  -H "Authorization: Bearer ${maskedKey ?? "<your-api-key>"}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "book_id": "${bookId}",
    "query": "<your question about this book>"
  }'`;

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
            Use this book via the API
          </h2>
          <p className="text-ink-3 text-xs">
            POST a query and stream the answer. The agent fetch endpoint is
            the production path for plugging this book into your tooling.
          </p>
        </div>
      )}

      <div>
        <Eyebrow>BOOK ID</Eyebrow>
        <div className="font-mono text-[12px] bg-paper-2 border border-rule px-2 py-1.5 break-all select-all text-ink mt-1.5">
          {bookId}
        </div>
        {bookSlug && (
          <div className="font-mono text-[11px] text-ink-3 mt-1">{bookSlug}</div>
        )}
      </div>

      <div>
        <Eyebrow>API KEY</Eyebrow>
        {activeKey ? (
          <div className="space-y-1 mt-1.5">
            <div className="font-mono text-[12px] text-ink">
              {maskedKey}{" "}
              <span className="text-ink-4">(masked — full secret shown only at issuance)</span>
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
              Issue an API key →
            </Link>
          </div>
        )}
      </div>

      <div>
        <Eyebrow>REQUEST</Eyebrow>
        <pre className="font-mono text-[12px] bg-paper-2 border border-rule p-3 overflow-x-auto whitespace-pre text-ink mt-1.5">
          {curl}
        </pre>
        <p className="text-xs text-ink-3 mt-2">
          The <code className="font-mono text-ink-2">-N</code> flag disables
          curl&apos;s output buffering so the SSE stream surfaces
          incrementally. Replace the masked prefix with your full key (shown
          only once at issuance).
        </p>
      </div>
    </div>
  );
}
