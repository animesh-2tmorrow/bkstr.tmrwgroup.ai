"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { MarkdownFileInput } from "./markdown-file-input";

// Phase 4 Stream B — client form for /dashboard/books/new. Fields:
//   - Title (required, 1..255)
//   - Slug (required, 1..128, /^[a-z0-9-]+$/, auto-derived from title on
//     change but operator-editable thereafter)
//   - Domain (required, 1..64)
//   - Description (optional, 0..5000)
//   - Content (required, markdown, up to 1MB) — either pasted into the textarea
//     OR loaded from a .md file via the MarkdownFileInput above it. The file is
//     read client-side (FileReader) and its text populates the textarea; there
//     is no server endpoint for the upload — file pick is UI sugar, the POST
//     /api/books/new payload shape is unchanged. See Stream I (D15.13).
//   - Price USD (required, >= $0.50 per Stripe minimum)
//   - Cover Image (optional, JPEG/PNG/WebP/GIF, max 5MB) — uploaded to S3
//     via POST /api/books/[id]/cover after book creation. Storefront renders
//     a domain-initial placeholder tile when no cover is present.
//
// Cover upload flow:
//   1. User selects a file — local preview shown immediately.
//   2. On "Publish book" submit, the book is created first (POST /api/books/new).
//   3. If a cover file was selected, a second request uploads it to S3 via
//      POST /api/books/[id]/cover (multipart/form-data).
//   4. On success, redirect to /dashboard/library?book=<id>.
//   This two-step approach avoids multipart parsing in the book-creation route
//   and keeps the Stripe-first atomicity invariant (CC-9 / D11.7) intact.

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);
}

const SLUG_REGEX = /^[a-z0-9-]+$/;
const MAX_COVER_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_COVER_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];

export function NewBookForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [domain, setDomain] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [contentFilename, setContentFilename] = useState<string | null>(null);
  const [priceDollars, setPriceDollars] = useState("");

  // Cover image state
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitStep, setSubmitStep] = useState<"idle" | "creating" | "uploading-cover" | "done">("idle");
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

  function onCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    setCoverError(null);
    const file = e.target.files?.[0];
    if (!file) {
      setCoverFile(null);
      setCoverPreview(null);
      return;
    }
    if (!ALLOWED_COVER_TYPES.includes(file.type.toLowerCase())) {
      setCoverError("Unsupported file type. Please upload a JPEG, PNG, WebP, or GIF.");
      setCoverFile(null);
      setCoverPreview(null);
      return;
    }
    if (file.size > MAX_COVER_BYTES) {
      setCoverError(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 5 MB.`);
      setCoverFile(null);
      setCoverPreview(null);
      return;
    }
    setCoverFile(file);
    // Generate local preview URL
    const previewUrl = URL.createObjectURL(file);
    setCoverPreview(previewUrl);
  }

  function removeCover() {
    setCoverFile(null);
    setCoverPreview(null);
    setCoverError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setStripeReconcile(null);

    // Client-side validation
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
    setSubmitStep("creating");

    let bookId: string | undefined;

    try {
      // Step 1 — Create the book
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
        if (body.orphanStripeProductId) {
          setStripeReconcile(
            `Stripe Product '${body.orphanStripeProductId}' (Price '${body.orphanStripePriceId ?? "?"}') exists in Stripe but no local Book was created. ${body.recovery ?? "Operator: reconcile via Stripe Dashboard."}`,
          );
        }
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      bookId = body.id;

      // Step 2 — Upload cover image if one was selected
      if (coverFile && bookId) {
        setSubmitStep("uploading-cover");
        const formData = new FormData();
        formData.append("cover", coverFile);

        const coverRes = await fetch(`/api/books/${bookId}/cover`, {
          method: "POST",
          body: formData,
        });

        if (!coverRes.ok) {
          // Cover upload failed — book is still created, just without a cover.
          // Log a warning but don't block the redirect; publisher can re-upload later.
          const coverBody = await coverRes.json().catch(() => ({})) as { error?: string };
          console.warn(`[new-book-form] Cover upload failed for book ${bookId}: ${coverBody.error ?? "unknown error"}`);
          // Surface a non-blocking warning in the UI
          setError(`Book published, but cover upload failed: ${coverBody.error ?? "unknown error"}. You can re-upload the cover from the library.`);
          // Still redirect after a short delay
          setTimeout(() => router.push(`/dashboard/library?book=${bookId ?? ""}`), 3000);
          return;
        }
      }

      setSubmitStep("done");
      router.push(`/dashboard/library?book=${bookId ?? ""}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create book");
    } finally {
      setSubmitting(false);
      setSubmitStep("idle");
    }
  }

  const submitLabel = () => {
    if (!submitting) return "Publish book";
    if (submitStep === "creating") return "Creating book…";
    if (submitStep === "uploading-cover") return "Uploading cover…";
    return "Publishing…";
  };

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
          placeholder="Short prose summary buyers will see in the storefront."
          className="w-full px-3 py-2 border border-[#E5DCC8] rounded-lg bg-white text-sm"
          disabled={submitting}
        />
        <p className="text-xs text-gray-500 mt-1">
          {description.length} / 5000 chars. Empty descriptions render as &ldquo;No description yet.&rdquo;
        </p>
      </div>

      {/* Cover Image Upload */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">
          Cover Image <span className="font-normal text-gray-500">(optional)</span>
        </label>

        {coverPreview ? (
          <div className="flex items-start gap-4">
            <div className="relative w-24 h-32 rounded-lg overflow-hidden border border-[#E5DCC8] shadow-sm flex-shrink-0">
              <Image
                src={coverPreview}
                alt="Cover preview"
                fill
                className="object-cover"
                unoptimized
              />
            </div>
            <div className="flex flex-col gap-2 pt-1">
              <p className="text-sm text-gray-700 font-medium">{coverFile?.name}</p>
              <p className="text-xs text-gray-500">
                {coverFile ? `${(coverFile.size / 1024).toFixed(0)} KB` : ""}
              </p>
              <button
                type="button"
                onClick={removeCover}
                disabled={submitting}
                className="text-xs text-red-600 hover:text-red-800 font-semibold underline text-left"
              >
                Remove cover
              </button>
            </div>
          </div>
        ) : (
          <div
            onClick={() => !submitting && fileInputRef.current?.click()}
            className="border-2 border-dashed border-[#E5DCC8] rounded-xl p-6 text-center cursor-pointer hover:border-gray-400 hover:bg-[#F5F0E4] transition-colors"
          >
            <div className="text-3xl mb-2">🖼️</div>
            <p className="text-sm font-semibold text-gray-700">Click to upload a cover image</p>
            <p className="text-xs text-gray-500 mt-1">JPEG, PNG, WebP, or GIF — max 5 MB</p>
            <p className="text-xs text-gray-400 mt-1">Recommended: 3:4 portrait ratio (e.g. 600×800 px)</p>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
          onChange={onCoverChange}
          className="hidden"
          disabled={submitting}
        />

        {coverError && (
          <p className="text-xs text-red-600 mt-1">{coverError}</p>
        )}
      </div>

      <MarkdownFileInput
        onContentLoaded={(text, filename) => {
          setContent(text);
          setContentFilename(filename);
        }}
        currentFilename={contentFilename ?? undefined}
        onClear={() => {
          setContent("");
          setContentFilename(null);
        }}
        disabled={submitting}
      />

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
        {submitLabel()}
      </button>
    </form>
  );
}
