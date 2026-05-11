"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Phase 4 Stream B — client form for /dashboard/books/new. Fields:
//   - Title (required, 1..255)
//   - Slug (required, 1..128, /^[a-z0-9-]+$/, auto-derived from title on
//     change but operator-editable thereafter)
//   - Domain (required, 1..64)
//   - Description (optional, 0..5000)
//   - Content (required, markdown, up to 1MB)
//   - Price USD (required, >= $0.50 per Stripe minimum)
// Submit posts to POST /api/books/new and, on 201, navigates to the dashboard.
//
// Slug auto-derivation: if the user hasn't manually edited slug, every change
// to title re-derives it. Manual edit "locks" the slug; further title changes
// no longer overwrite. Matches the design doc Q B-Q3 recommendation (editable
// with a sensible default).

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);
}

const SLUG_REGEX = /^[a-z0-9-]+$/;

export function NewBookForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [domain, setDomain] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [priceDollars, setPriceDollars] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stripeReconcile, setStripeReconcile] = useState<string | null>(null);

  function onTitleChange(next: string) {
    setTitle(next);
    if (!slugManuallyEdited) {
      setSlug(slugify(next));
    }
  }

  function onSlugChange(next: string) {
    setSlugManuallyEdited(true);
    setSlug(next.toLowerCase());
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setStripeReconcile(null);

    // Client-side validation. The server re-validates identically; this just
    // saves a round-trip on obviously-bad input.
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0 || trimmedTitle.length > 255) {
      setError("Title is required (1..255 chars).");
      return;
    }
    const trimmedSlug = slug.trim().toLowerCase();
    if (trimmedSlug.length === 0 || trimmedSlug.length > 128 || !SLUG_REGEX.test(trimmedSlug)) {
      setError("Slug must be 1..128 chars of lowercase letters, digits, and hyphens.");
      return;
    }
    const trimmedDomain = domain.trim();
    if (trimmedDomain.length === 0 || trimmedDomain.length > 64) {
      setError("Domain is required (1..64 chars).");
      return;
    }
    if (description.length > 5_000) {
      setError("Description must be 5000 chars or fewer.");
      return;
    }
    if (content.trim().length === 0) {
      setError("Content is required.");
      return;
    }
    if (content.length > 1_000_000) {
      setError("Content must be 1MB or smaller.");
      return;
    }
    const dollars = Number(priceDollars);
    if (!Number.isFinite(dollars) || dollars < 0.5) {
      setError("Price must be at least $0.50 (Stripe minimum charge).");
      return;
    }
    const cents = Math.round(dollars * 100);

    setSubmitting(true);
    try {
      const res = await fetch("/api/books/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmedTitle,
          slug: trimmedSlug,
          domain: trimmedDomain,
          description: description.trim(),
          content,
          price_usd_cents: cents,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        id?: string;
        slug?: string;
        error?: string;
        orphanStripeProductId?: string;
        orphanStripePriceId?: string;
        recovery?: string;
      };
      if (!res.ok) {
        // Surface the partial-failure recovery details when present so the
        // operator can identify the orphan Stripe Product without needing
        // server logs (Scenario G recovery surface).
        if (body.orphanStripeProductId) {
          setStripeReconcile(
            `Stripe Product '${body.orphanStripeProductId}' (Price '${body.orphanStripePriceId ?? "?"}') exists in Stripe but no local Book was created. ${body.recovery ?? "Operator: reconcile via Stripe Dashboard."}`,
          );
        }
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      // 201 — redirect to the dashboard with ?book=<id> so Stream C's Library
      // view (when it lands) can highlight the just-created row. Until then,
      // the existing /dashboard ignores the param and renders normally.
      router.push(`/dashboard/library?book=${body.id ?? ""}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create book");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-[#FAF6EC] border border-[#E5DCC8] rounded-xl shadow-sm p-6 space-y-5"
    >
      <div>
        <label htmlFor="title" className="block text-sm font-semibold text-gray-700 mb-1">
          Title
        </label>
        <input
          id="title"
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          maxLength={255}
          required
          placeholder="NotebookLM Skill"
          className="w-full px-3 py-2 border border-[#E5DCC8] rounded-lg bg-white text-sm"
          disabled={submitting}
        />
      </div>

      <div>
        <label htmlFor="slug" className="block text-sm font-semibold text-gray-700 mb-1">
          Slug
        </label>
        <input
          id="slug"
          type="text"
          value={slug}
          onChange={(e) => onSlugChange(e.target.value)}
          maxLength={128}
          required
          placeholder="notebooklm-skill"
          className="w-full px-3 py-2 border border-[#E5DCC8] rounded-lg bg-white text-sm font-mono"
          disabled={submitting}
        />
        <p className="text-xs text-gray-500 mt-1">
          Lowercase letters, digits, and hyphens only. Auto-derived from the title; edit to override.
          Must be unique among your publisher&apos;s books.
        </p>
      </div>

      <div>
        <label htmlFor="domain" className="block text-sm font-semibold text-gray-700 mb-1">
          Domain
        </label>
        <input
          id="domain"
          type="text"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          maxLength={64}
          required
          placeholder="skill"
          className="w-full px-3 py-2 border border-[#E5DCC8] rounded-lg bg-white text-sm"
          disabled={submitting}
        />
        <p className="text-xs text-gray-500 mt-1">
          Free-text taxonomy tag (e.g. <code>skill</code>, <code>reference</code>, <code>playbook</code>).
        </p>
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-semibold text-gray-700 mb-1">
          Description <span className="font-normal text-gray-500">(optional, but recommended)</span>
        </label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={5_000}
          rows={3}
          placeholder="Short prose summary buyers will see in the Library."
          className="w-full px-3 py-2 border border-[#E5DCC8] rounded-lg bg-white text-sm"
          disabled={submitting}
        />
        <p className="text-xs text-gray-500 mt-1">
          {description.length} / 5000 chars. Empty descriptions render as &ldquo;No description yet.&rdquo;
        </p>
      </div>

      <div>
        <label htmlFor="content" className="block text-sm font-semibold text-gray-700 mb-1">
          Content (markdown)
        </label>
        <textarea
          id="content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={1_000_000}
          rows={14}
          required
          placeholder={"# Heading\n\nMarkdown body that an agent fetch will return."}
          className="w-full px-3 py-2 border border-[#E5DCC8] rounded-lg bg-white text-sm font-mono"
          disabled={submitting}
        />
        <p className="text-xs text-gray-500 mt-1">
          Stored inline as the first version. Up to 1MB.
        </p>
      </div>

      <div>
        <label htmlFor="price" className="block text-sm font-semibold text-gray-700 mb-1">
          Price (USD)
        </label>
        <div className="flex items-center gap-2">
          <span className="text-gray-500">$</span>
          <input
            id="price"
            type="number"
            step="0.01"
            min="0.50"
            value={priceDollars}
            onChange={(e) => setPriceDollars(e.target.value)}
            placeholder="9.99"
            required
            className="flex-grow px-3 py-2 border border-[#E5DCC8] rounded-lg bg-white text-sm"
            disabled={submitting}
          />
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Minimum $0.50 (Stripe USD floor). A fresh Stripe Price is created on submit.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 rounded-lg">
          <div className="font-semibold mb-1">Failed to create book</div>
          <div>{error}</div>
          {stripeReconcile && (
            <div className="mt-2 text-xs">
              <span className="font-semibold">Stripe reconcile note:</span> {stripeReconcile}
            </div>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="bg-black text-[#FAF6EC] px-4 py-2 rounded-lg text-sm font-bold hover:bg-black shadow-sm disabled:opacity-50"
      >
        {submitting ? "Publishing…" : "Publish book"}
      </button>
    </form>
  );
}
