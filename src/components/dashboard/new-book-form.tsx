"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { MarkdownFileInput } from "./markdown-file-input";
// Phase 6 Stream L (D18.1) — single-source-of-truth import; previously this
// file carried its own `MAX_ZIP_BYTES = 10 * 1024 * 1024` literal with an
// inline pointer comment at the server-side constant (follow-up #116). The
// shared module is server- AND client-safe (constants only; no Node-only
// imports), so the form can import it directly.
import { MAX_ZIP_BYTES } from "@/lib/zip/limits";

// Phase 4 Stream B / Phase 5 Stream I / Phase 6 Stream K — client form for
// /dashboard/books/new. Three upload modes:
//
//   - "paste"     (default; T5 sub-decision): paste markdown into the Content
//                 textarea; POST application/json to /api/books/new — the
//                 Stream B/I single-blob path. Slug-collision is a hard 409.
//   - "md-file":  MarkdownFileInput populates the Content textarea via
//                 client-side FileReader (Stream I, D15.13); same JSON POST as
//                 paste mode.
//   - "zip-file": multipart/form-data POST carries a .zip; the route dispatches
//                 to handleZipUpload (Stream K, D17.1) which parses manifest.yaml
//                 if present or falls back to filename sort, writes multi-chapter
//                 content into book_chapters, and is idempotent on re-upload.
//                 In zip mode title/slug/domain are CLIENT-OPTIONAL — the server
//                 uses manifest first, form fallback, and returns 400 if neither
//                 source supplies a required field. Price is form-only and
//                 required only when the slug is new under the caller's
//                 publisher; the slug-prefetch (T2 / GET /api/books/check-slug)
//                 locks the price field for new-version uploads.
//
// Cover upload stays a separate POST /api/books/[id]/cover step regardless of
// mode (Stream H two-request flow preserved, T4).

type UploadMode = "paste" | "md-file" | "zip-file";

type SlugCheckState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "new" }
  | { state: "exists"; title: string; priceCents: number | null; latestVersion: number | null }
  | { state: "error"; message: string };

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
// MAX_ZIP_BYTES is imported from @/lib/zip/limits (Stream L / #116 close).

export function NewBookForm() {
  const router = useRouter();
  const [mode, setMode] = useState<UploadMode>("paste"); // T5 default
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [domain, setDomain] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [contentFilename, setContentFilename] = useState<string | null>(null);
  const [priceDollars, setPriceDollars] = useState("");

  // Cover image state (Stream H)
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Zip state (Stream K)
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const [slugCheck, setSlugCheck] = useState<SlugCheckState>({ state: "idle" });

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

  // Slug-prefetch (T2): only relevant in zip mode, and only when the slug is
  // well-formed. Debounced 400 ms. When the slug resolves to an existing book
  // we pre-fill / lock the price field with that book's current price.
  useEffect(() => {
    if (mode !== "zip-file") {
      setSlugCheck({ state: "idle" });
      return;
    }
    const candidate = slug.trim().toLowerCase();
    if (candidate.length === 0 || !SLUG_REGEX.test(candidate)) {
      setSlugCheck({ state: "idle" });
      return;
    }
    setSlugCheck({ state: "checking" });
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/books/check-slug?slug=${encodeURIComponent(candidate)}`);
        if (!res.ok) {
          setSlugCheck({ state: "error", message: `Couldn't check slug (HTTP ${res.status})` });
          return;
        }
        const body = (await res.json()) as
          | { exists: false }
          | {
              exists: true;
              bookId: string;
              title: string;
              currentPriceUsdCents: number | null;
              latestVersion: number | null;
              status: string;
            };
        if (body.exists) {
          setSlugCheck({
            state: "exists",
            title: body.title,
            priceCents: body.currentPriceUsdCents,
            latestVersion: body.latestVersion,
          });
          if (body.currentPriceUsdCents != null) {
            setPriceDollars((body.currentPriceUsdCents / 100).toFixed(2));
          }
        } else {
          setSlugCheck({ state: "new" });
        }
      } catch (err) {
        setSlugCheck({
          state: "error",
          message: err instanceof Error ? err.message : "Couldn't check slug",
        });
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [slug, mode]);

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
    const previewUrl = URL.createObjectURL(file);
    setCoverPreview(previewUrl);
  }

  function removeCover() {
    setCoverFile(null);
    setCoverPreview(null);
    setCoverError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onZipChange(e: React.ChangeEvent<HTMLInputElement>) {
    setZipError(null);
    const file = e.target.files?.[0];
    if (!file) {
      setZipFile(null);
      return;
    }
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".zip")) {
      setZipError("Wrong file type — choose a .zip file.");
      setZipFile(null);
      return;
    }
    if (file.size > MAX_ZIP_BYTES) {
      setZipError(
        `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${(MAX_ZIP_BYTES / 1024 / 1024).toFixed(0)} MB.`,
      );
      setZipFile(null);
      return;
    }
    setZipFile(file);
  }

  function removeZip() {
    setZipFile(null);
    setZipError(null);
    if (zipInputRef.current) zipInputRef.current.value = "";
  }

  function onModeChange(next: UploadMode) {
    setMode(next);
    setError(null);
    setStripeReconcile(null);
  }

  async function submitZipMode(): Promise<{ bookId?: string } | { error: string }> {
    if (!zipFile) {
      return { error: "Choose a .zip file before submitting." };
    }
    // Title/slug/domain are CLIENT-OPTIONAL in zip mode — server will fall back
    // to manifest first, form values second; if neither has them server 400s.
    // We still validate shape if the publisher TYPED something (avoid sending
    // garbage that the server will reject).
    const trimmedTitle = title.trim();
    if (trimmedTitle.length > 255) return { error: "Title must be 255 chars or fewer." };
    const trimmedSlug = slug.trim().toLowerCase();
    if (trimmedSlug.length > 0 && (trimmedSlug.length > 128 || !SLUG_REGEX.test(trimmedSlug))) {
      return { error: "Slug must be 1..128 chars of lowercase letters, digits, and hyphens." };
    }
    const trimmedDomain = domain.trim();
    if (trimmedDomain.length > 64) return { error: "Domain must be 64 chars or fewer." };
    if (description.length > 5_000) return { error: "Description must be 5000 chars or fewer." };

    // Price required only on the new-book branch; on the existing-book branch
    // the server ignores the field per T2.
    let priceCents: number | undefined;
    if (slugCheck.state !== "exists") {
      const dollars = Number(priceDollars);
      if (!Number.isFinite(dollars) || dollars < 0.5) {
        return { error: "Price must be at least $0.50 for new books (Stripe USD minimum)." };
      }
      priceCents = Math.round(dollars * 100);
    }

    const fd = new FormData();
    fd.append("zip", zipFile);
    if (trimmedTitle) fd.append("title", trimmedTitle);
    if (trimmedSlug) fd.append("slug", trimmedSlug);
    if (trimmedDomain) fd.append("domain", trimmedDomain);
    if (description.trim()) fd.append("description", description.trim());
    if (priceCents != null) fd.append("price_usd_cents", String(priceCents));

    const res = await fetch("/api/books/new", { method: "POST", body: fd });
    const body = (await res.json().catch(() => ({}))) as {
      id?: string;
      slug?: string;
      version?: number;
      unchanged?: boolean;
      error?: string;
      code?: string;
      orphanStripeProductId?: string;
      orphanStripePriceId?: string;
      recovery?: string;
    };
    if (!res.ok) {
      if (body.orphanStripeProductId) {
        setStripeReconcile(
          `Stripe Product '${body.orphanStripeProductId}' (Price '${body.orphanStripePriceId ?? "?"}') was created but no local row landed. ${body.recovery ?? "Operator: reconcile via Stripe Dashboard."}`,
        );
      }
      return { error: body.error ?? `HTTP ${res.status}` };
    }
    return { bookId: body.id };
  }

  async function submitJsonMode(): Promise<{ bookId?: string } | { error: string }> {
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0 || trimmedTitle.length > 255) {
      return { error: "Title is required (1..255 chars)." };
    }
    const trimmedSlug = slug.trim().toLowerCase();
    if (trimmedSlug.length === 0 || trimmedSlug.length > 128 || !SLUG_REGEX.test(trimmedSlug)) {
      return { error: "Slug must be 1..128 chars of lowercase letters, digits, and hyphens." };
    }
    const trimmedDomain = domain.trim();
    if (trimmedDomain.length === 0 || trimmedDomain.length > 64) {
      return { error: "Domain is required (1..64 chars)." };
    }
    if (description.length > 5_000) return { error: "Description must be 5000 chars or fewer." };
    if (content.trim().length === 0) return { error: "Content is required." };
    if (content.length > 1_000_000) return { error: "Content must be 1MB or smaller." };
    const dollars = Number(priceDollars);
    if (!Number.isFinite(dollars) || dollars < 0.5) {
      return { error: "Price must be at least $0.50 (Stripe minimum charge)." };
    }
    const cents = Math.round(dollars * 100);

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
      return { error: body.error ?? `HTTP ${res.status}` };
    }
    return { bookId: body.id };
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setStripeReconcile(null);

    setSubmitting(true);
    setSubmitStep("creating");

    try {
      const result =
        mode === "zip-file" ? await submitZipMode() : await submitJsonMode();
      if ("error" in result) throw new Error(result.error);
      const bookId = result.bookId;

      // Cover upload (unchanged from Stream H — two-request flow)
      if (coverFile && bookId) {
        setSubmitStep("uploading-cover");
        const formData = new FormData();
        formData.append("cover", coverFile);
        const coverRes = await fetch(`/api/books/${bookId}/cover`, {
          method: "POST",
          body: formData,
        });
        if (!coverRes.ok) {
          const coverBody = (await coverRes.json().catch(() => ({}))) as { error?: string };
          console.warn(
            `[new-book-form] Cover upload failed for book ${bookId}: ${coverBody.error ?? "unknown error"}`,
          );
          setError(
            `Book published, but cover upload failed: ${coverBody.error ?? "unknown error"}. You can re-upload the cover from the library.`,
          );
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

  const titleSlugDomainRequired = mode !== "zip-file";
  const priceLockedToExisting = mode === "zip-file" && slugCheck.state === "exists";
  const priceRequired = mode !== "zip-file" || slugCheck.state === "new";

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-[#FAF6EC] border border-[#E5DCC8] rounded-xl shadow-sm p-6 space-y-5"
    >
      {/* Mode selector — Stream K (D17.1, T5 default = paste) */}
      <fieldset className="border border-[#E5DCC8] rounded-lg p-3 bg-white">
        <legend className="px-2 text-sm font-semibold text-gray-700">Upload mode</legend>
        <div className="flex flex-col sm:flex-row sm:gap-4 gap-2">
          {([
            ["paste", "Paste markdown"],
            ["md-file", "Upload a single .md file"],
            ["zip-file", "Upload a .zip folder (multi-chapter)"],
          ] as const).map(([value, label]) => (
            <label key={value} className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name="upload-mode"
                value={value}
                checked={mode === value}
                onChange={() => onModeChange(value)}
                disabled={submitting}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="title" className="block text-sm font-semibold text-gray-700 mb-1">
          Title{" "}
          {!titleSlugDomainRequired && (
            <span className="font-normal text-gray-500">(optional — derived from manifest.yaml if present)</span>
          )}
        </label>
        <input
          id="title"
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          maxLength={255}
          required={titleSlugDomainRequired}
          placeholder="NotebookLM Skill"
          className="w-full px-3 py-2 border border-[#E5DCC8] rounded-lg bg-white text-sm"
          disabled={submitting}
        />
      </div>

      <div>
        <label htmlFor="slug" className="block text-sm font-semibold text-gray-700 mb-1">
          Slug{" "}
          {!titleSlugDomainRequired && (
            <span className="font-normal text-gray-500">(optional — derived from manifest.yaml if present)</span>
          )}
        </label>
        <input
          id="slug"
          type="text"
          value={slug}
          onChange={(e) => onSlugChange(e.target.value)}
          maxLength={128}
          required={titleSlugDomainRequired}
          placeholder="notebooklm-skill"
          className="w-full px-3 py-2 border border-[#E5DCC8] rounded-lg bg-white text-sm font-mono"
          disabled={submitting}
        />
        <p className="text-xs text-gray-500 mt-1">
          Lowercase letters, digits, and hyphens only. Auto-derived from the title; edit to override.
          Must be unique among your publisher&apos;s books.
        </p>
        {/* Slug prefetch banner (T2) — only when in zip mode */}
        {mode === "zip-file" && slugCheck.state === "exists" && (
          <div className="mt-2 rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
            Slug <code>{slug}</code> exists — uploading creates{" "}
            <strong>v{(slugCheck.latestVersion ?? 0) + 1}</strong> of &ldquo;
            <em>{slugCheck.title}</em>&rdquo;.
            {slugCheck.priceCents != null && (
              <>
                {" "}
                Price stays at <strong>${(slugCheck.priceCents / 100).toFixed(2)}</strong>; the
                price field below is locked and ignored on submit.
              </>
            )}
          </div>
        )}
        {mode === "zip-file" && slugCheck.state === "checking" && (
          <p className="mt-1 text-xs text-gray-500">Checking slug…</p>
        )}
        {mode === "zip-file" && slugCheck.state === "error" && (
          <p className="mt-1 text-xs text-red-600">{slugCheck.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="domain" className="block text-sm font-semibold text-gray-700 mb-1">
          Domain{" "}
          {!titleSlugDomainRequired && (
            <span className="font-normal text-gray-500">(optional — derived from manifest.yaml if present)</span>
          )}
        </label>
        <input
          id="domain"
          type="text"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          maxLength={64}
          required={titleSlugDomainRequired}
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

      {/* Cover Image Upload — unchanged from Stream H (T4) */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">
          Cover Image <span className="font-normal text-gray-500">(optional)</span>
        </label>

        {coverPreview ? (
          <div className="flex items-start gap-4">
            <div className="relative w-24 h-32 rounded-lg overflow-hidden border border-[#E5DCC8] shadow-sm flex-shrink-0">
              <Image src={coverPreview} alt="Cover preview" fill className="object-cover" unoptimized />
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

        {coverError && <p className="text-xs text-red-600 mt-1">{coverError}</p>}
      </div>

      {/* md-file mode: the Stream I file picker */}
      {mode === "md-file" && (
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
      )}

      {/* Content textarea — paste + md-file modes only */}
      {(mode === "paste" || mode === "md-file") && (
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
      )}

      {/* zip-file mode: the Stream K zip picker */}
      {mode === "zip-file" && (
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            Upload a .zip folder
          </label>
          {zipFile ? (
            <div className="flex items-start gap-4">
              <div className="text-3xl flex-shrink-0">🗂️</div>
              <div className="flex flex-col gap-2 pt-1">
                <p className="text-sm text-gray-700 font-medium">{zipFile.name}</p>
                <p className="text-xs text-gray-500">{(zipFile.size / 1024).toFixed(0)} KB</p>
                <button
                  type="button"
                  onClick={removeZip}
                  disabled={submitting}
                  className="text-xs text-red-600 hover:text-red-800 font-semibold underline text-left"
                >
                  Clear file
                </button>
              </div>
            </div>
          ) : (
            <div
              onClick={() => !submitting && zipInputRef.current?.click()}
              className="border-2 border-dashed border-[#E5DCC8] rounded-xl p-6 text-center cursor-pointer hover:border-gray-400 hover:bg-[#F5F0E4] transition-colors"
            >
              <div className="text-3xl mb-2">🗂️</div>
              <p className="text-sm font-semibold text-gray-700">Click to choose a .zip file</p>
              <p className="text-xs text-gray-500 mt-1">
                .zip with optional manifest.yaml + chapter .md files — max{" "}
                {(MAX_ZIP_BYTES / 1024 / 1024).toFixed(0)} MB
              </p>
            </div>
          )}
          <input
            ref={zipInputRef}
            type="file"
            accept=".zip,application/zip"
            onChange={onZipChange}
            className="hidden"
            disabled={submitting}
          />
          {zipError && <p className="text-xs text-red-600 mt-1">{zipError}</p>}
        </div>
      )}

      <div>
        <label htmlFor="price" className="block text-sm font-semibold text-gray-700 mb-1">
          Price (USD){" "}
          {priceLockedToExisting && (
            <span className="font-normal text-gray-500">
              (locked — new version of an existing book; price stays at the current value)
            </span>
          )}
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
            required={priceRequired}
            readOnly={priceLockedToExisting}
            className="flex-grow px-3 py-2 border border-[#E5DCC8] rounded-lg bg-white text-sm disabled:opacity-50"
            disabled={submitting || priceLockedToExisting}
          />
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {priceLockedToExisting
            ? "Price changes happen on the pricing page, not on upload."
            : "Minimum $0.50 (Stripe USD floor). A fresh Stripe Price is created on submit."}
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
