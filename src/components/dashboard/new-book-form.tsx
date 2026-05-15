"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { MarkdownFileInput } from "./markdown-file-input";
import { BookCover } from "@/components/design";
import type { BookCoverPalette } from "@/components/design/book-cover";
// Phase 6 Stream L (D18.1) — single-source-of-truth import; previously this
// file carried its own `MAX_ZIP_BYTES = 10 * 1024 * 1024` literal with an
// inline pointer comment at the server-side constant (follow-up #116). The
// shared module is server- AND client-safe (constants only; no Node-only
// imports), so the form can import it directly.
import { MAX_ZIP_BYTES } from "@/lib/zip/limits";

// Phase 4 Stream B / Phase 5 Stream I / Phase 6 Stream K — client form for
// /dashboard/books/new. Three upload modes:
//
//   - "paste"     (default): paste markdown into the Content textarea; POST
//                 application/json to /api/books/new — the single-blob path.
//                 Slug-collision is a hard 409.
//   - "md-file":  MarkdownFileInput populates the Content textarea via
//                 client-side FileReader (D15.13); same JSON POST as paste.
//   - "zip-file": multipart/form-data POST carries a .zip; the route dispatches
//                 to handleZipUpload (D17.1) which parses manifest.yaml if
//                 present or falls back to filename sort, writes multi-chapter
//                 content into book_chapters, and is idempotent on re-upload.
//                 In zip mode title/slug/domain are CLIENT-OPTIONAL — the server
//                 uses manifest first, form fallback, and returns 400 if neither
//                 source supplies a required field. Price is form-only and
//                 required only when the slug is new under the caller's
//                 publisher; the slug-prefetch (T2 / GET /api/books/check-slug)
//                 locks the price field for new-version uploads.
//
// bkstr redesign PR 8 — cover-image upload (the photographic two-request
// flow from Stream H) is REMOVED from the form per HANDOFF.md "no
// imagery on book covers." Replaced with a palette selector + glyph input
// + a live <BookCover> preview that updates as the publisher types title /
// changes palette / changes glyph. The columns persist on books.palette /
// books.glyph (PR 8 schema) and are rendered server-side everywhere a
// cover renders. The /api/books/[id]/cover endpoint and the
// books.cover_image_url DB column survive for one cycle but are now
// orphaned — no UI writes them.

type UploadMode = "paste" | "md-file" | "zip-file";

// Phase 6 Stream L (D18.1) — kind toggle at top of the form. Book mode is
// the existing behavior unchanged. Skill mode forces the upload mode to
// "zip-file" (skills are inherently multi-file zip uploads), hides
// title/domain/description/cover-preview (manifest-from-SKILL.md-frontmatter
// supplies title and description; domain doesn't apply; covers don't apply
// to skills per Q4), and posts to /api/skills/new instead of /api/books/new.
type Kind = "book" | "skill";

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
// MAX_ZIP_BYTES is imported from @/lib/zip/limits.

// PR 8 — palette options for the live preview selector. Order mirrors
// BookCoverPalette in src/components/design/book-cover.tsx; default is
// 'indigo' (matches the DB-side column default for safety symmetry).
const PALETTE_OPTIONS: ReadonlyArray<{ key: BookCoverPalette; label: string }> = [
  { key: "saffron", label: "Saffron — warm" },
  { key: "forest", label: "Forest — calm" },
  { key: "oxblood", label: "Oxblood — gravity" },
  { key: "indigo", label: "Indigo — infrastructure" },
  { key: "plum", label: "Plum — research" },
  { key: "slate", label: "Slate — neutral" },
];

const DEFAULT_PALETTE: BookCoverPalette = "indigo";
const DEFAULT_GLYPH = "?";

// First uppercase ASCII letter of input, '?' fallback. Mirrors the
// migration's glyph backfill heuristic so what the publisher sees in the
// preview matches what the server will store if they leave glyph alone.
function deriveGlyph(title: string): string {
  const match = title.match(/[A-Za-z]/);
  return match ? match[0].toUpperCase() : DEFAULT_GLYPH;
}

// Shared token-styled className blocks reused across inputs.
const LABEL = "block font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 mb-1.5";
const INPUT =
  "w-full px-3 py-2 border border-rule bg-paper text-sm text-ink focus:outline-none focus:border-ink disabled:opacity-50 placeholder:text-ink-4";
const HELP = "font-mono text-[11px] text-ink-3 mt-1.5";

export function NewBookForm() {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("book"); // Stream L default — Book mode
  const [mode, setMode] = useState<UploadMode>("paste"); // T5 default
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [domain, setDomain] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [contentFilename, setContentFilename] = useState<string | null>(null);
  const [priceDollars, setPriceDollars] = useState("");

  // PR 8 — cover-driver state. Defaults match the DB-side column defaults
  // ('indigo' / '?') so the preview renders sensibly before the publisher
  // touches anything. `glyphManuallyEdited` mirrors `slugManuallyEdited`
  // — the glyph auto-derives from the title until the publisher overrides.
  const [palette, setPalette] = useState<BookCoverPalette>(DEFAULT_PALETTE);
  const [glyph, setGlyph] = useState<string>(DEFAULT_GLYPH);
  const [glyphManuallyEdited, setGlyphManuallyEdited] = useState(false);

  // Zip state (Stream K)
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const [slugCheck, setSlugCheck] = useState<SlugCheckState>({ state: "idle" });

  const [submitting, setSubmitting] = useState(false);
  const [submitStep, setSubmitStep] = useState<"idle" | "creating" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [stripeReconcile, setStripeReconcile] = useState<string | null>(null);

  function onTitleChange(next: string) {
    setTitle(next);
    if (!slugManuallyEdited) {
      setSlug(slugify(next));
    }
    if (!glyphManuallyEdited) {
      setGlyph(deriveGlyph(next));
    }
  }

  function onSlugChange(next: string) {
    setSlugManuallyEdited(true);
    setSlug(next.toLowerCase());
  }

  function onGlyphChange(next: string) {
    setGlyphManuallyEdited(true);
    // Clamp to single uppercase ASCII letter; empty input falls back to '?'
    // so the preview never renders a blank glyph zone.
    const upper = next.toUpperCase().replace(/[^A-Z?]/g, "");
    setGlyph(upper.length > 0 ? upper.slice(0, 1) : DEFAULT_GLYPH);
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
        // Phase 6 Stream L (D18.1) — append &kind=skill in skill mode so the
        // generalized /api/books/check-slug queries the skills table. Default
        // kind=book is preserved when no param is sent (Book-mode call).
        const kindParam = kind === "skill" ? "&kind=skill" : "";
        const res = await fetch(
          `/api/books/check-slug?slug=${encodeURIComponent(candidate)}${kindParam}`,
        );
        if (!res.ok) {
          setSlugCheck({ state: "error", message: `Couldn't check slug (HTTP ${res.status})` });
          return;
        }
        const body = (await res.json()) as
          | { exists: false }
          | {
              exists: true;
              bookId?: string;
              skillId?: string;
              title?: string;
              name?: string;
              currentPriceUsdCents: number | null;
              latestVersion: number | null;
              status: string;
              kind?: "skill";
            };
        if (body.exists) {
          const displayTitle = body.title ?? body.name ?? "—";
          setSlugCheck({
            state: "exists",
            title: displayTitle,
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
  }, [slug, mode, kind]);

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

  // Phase 6 Stream L (D18.1) — switching to Skill mode forces upload-mode to
  // zip-file and clears the book-specific state. PR 8 — also resets palette/
  // glyph since the cover preview hides in skill mode.
  function onKindChange(next: Kind) {
    setKind(next);
    setError(null);
    setStripeReconcile(null);
    if (next === "skill") {
      setMode("zip-file");
      setTitle("");
      setDomain("");
      setDescription("");
      setContent("");
      setContentFilename(null);
      setPalette(DEFAULT_PALETTE);
      setGlyph(DEFAULT_GLYPH);
      setGlyphManuallyEdited(false);
    }
    setSlugCheck({ state: "idle" });
  }

  async function submitZipMode(): Promise<{ bookId?: string } | { error: string }> {
    if (!zipFile) {
      return { error: "Choose a .zip file before submitting." };
    }
    const trimmedTitle = title.trim();
    if (trimmedTitle.length > 255) return { error: "Title must be 255 chars or fewer." };
    const trimmedSlug = slug.trim().toLowerCase();
    if (trimmedSlug.length > 0 && (trimmedSlug.length > 128 || !SLUG_REGEX.test(trimmedSlug))) {
      return { error: "Slug must be 1..128 chars of lowercase letters, digits, and hyphens." };
    }
    const trimmedDomain = domain.trim();
    if (trimmedDomain.length > 64) return { error: "Domain must be 64 chars or fewer." };
    if (description.length > 5_000) return { error: "Description must be 5000 chars or fewer." };

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
    if (kind === "book") {
      if (trimmedTitle) fd.append("title", trimmedTitle);
      if (trimmedDomain) fd.append("domain", trimmedDomain);
      if (description.trim()) fd.append("description", description.trim());
      // PR 8 — palette/glyph for zip uploads are not yet plumbed through
      // the multipart handler; defaults apply (DB column defaults). A
      // follow-up will derive palette/glyph from the manifest's domain/
      // title in the zip-handler. Today the zip-uploaded book renders with
      // 'indigo' / '?' until the publisher edits via a future cover-edit
      // surface or the next zip upload re-runs through the (future)
      // manifest-derived backfill.
    }
    if (trimmedSlug) fd.append("slug", trimmedSlug);
    if (priceCents != null) fd.append("price_usd_cents", String(priceCents));

    const endpoint = kind === "skill" ? "/api/skills/new" : "/api/books/new";
    const res = await fetch(endpoint, { method: "POST", body: fd });
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
        // PR 8 — typographic cover drivers go with the create. The server
        // route validates against the BookCoverPalette enum + the
        // single-letter glyph shape and falls back to DB defaults if
        // either is absent.
        palette,
        glyph,
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
      const entityId = result.bookId; // also holds the skill id when kind === "skill"

      // PR 8 — cover-image upload step REMOVED. Typographic covers replace
      // the photographic two-request flow; palette + glyph travel with the
      // initial create so there's no follow-up endpoint to call.

      setSubmitStep("done");
      // Stream L: skill uploads have no /dashboard/library counterpart yet
      // (deferred — future skill-library surface). Redirect skill uploads to
      // the public /skills/{slug} detail page when a slug was provided/derived
      // client-side, else to the /skills listing. Book uploads keep the
      // existing /dashboard/library?book=<id> redirect.
      if (kind === "skill") {
        const slugTyped = slug.trim().toLowerCase();
        router.push(slugTyped.length > 0 ? `/skills/${encodeURIComponent(slugTyped)}` : "/skills");
      } else {
        router.push(`/dashboard/library?book=${entityId ?? ""}`);
      }
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
    return "Publishing…";
  };

  // Stream L: in skill mode, title/domain are not collected from the form
  // (manifest's name/description authoritative; domain doesn't apply). Slug
  // remains optional in both modes' zip-upload variant.
  const titleSlugDomainRequired = mode !== "zip-file" && kind === "book";
  const priceLockedToExisting = mode === "zip-file" && slugCheck.state === "exists";
  const priceRequired = mode !== "zip-file" || slugCheck.state === "new";
  const showBookOnlyFields = kind === "book";
  // PR 8 — preview renders only for book mode. Skills don't have covers.
  const showCoverPreview = kind === "book";

  // PR 8 — preview cover data. Title fallback "Untitled" so the preview
  // doesn't render an empty title block before the publisher types.
  // Domain fallback matches the DB column default (NOT NULL but no
  // semantic default — use literal placeholder for the preview only).
  const previewBook = {
    title: title.trim() || "Untitled volume",
    glyph,
    domain: domain.trim() || "DOMAIN",
    palette,
    vol: "Vol. 01",
    version: "v1",
    author: "—",
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8 items-start">
      <form
        onSubmit={handleSubmit}
        className="bg-paper border border-rule p-8 space-y-6 max-w-3xl"
      >
        {/* Kind selector */}
        <section className="border-b border-rule pb-5">
          <div className={LABEL}>Kind</div>
          <div className="flex flex-col sm:flex-row sm:gap-6 gap-2">
            {([
              ["book", "Book"],
              ["skill", "Skill"],
            ] as const).map(([value, label]) => (
              <label key={value} className="inline-flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
                <input
                  type="radio"
                  name="content-kind"
                  value={value}
                  checked={kind === value}
                  onChange={() => onKindChange(value)}
                  disabled={submitting}
                  className="accent-ink"
                />
                <span className="font-serif">{label}</span>
              </label>
            ))}
          </div>
          {kind === "skill" && (
            <p className={HELP}>
              Skills upload as <code className="text-ink-2">.zip</code> with{" "}
              <code className="text-ink-2">SKILL.md</code> at the root carrying
              YAML frontmatter (<code className="text-ink-2">name</code>,{" "}
              <code className="text-ink-2">description</code>). The form below
              shows the skill-specific fields only.
            </p>
          )}
        </section>

        {/* Mode selector */}
        {kind === "book" && (
          <section className="border-b border-rule pb-5">
            <div className={LABEL}>Upload mode</div>
            <div className="flex flex-col sm:flex-row sm:gap-6 gap-2">
              {([
                ["paste", "Paste markdown"],
                ["md-file", "Upload a single .md file"],
                ["zip-file", "Upload a .zip folder (multi-chapter)"],
              ] as const).map(([value, label]) => (
                <label key={value} className="inline-flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
                  <input
                    type="radio"
                    name="upload-mode"
                    value={value}
                    checked={mode === value}
                    onChange={() => onModeChange(value)}
                    disabled={submitting}
                    className="accent-ink"
                  />
                  <span className="font-serif">{label}</span>
                </label>
              ))}
            </div>
          </section>
        )}

        {showBookOnlyFields && (
          <div>
            <label htmlFor="title" className={LABEL}>
              Title{" "}
              {!titleSlugDomainRequired && (
                <span className="text-ink-4 normal-case tracking-normal">
                  (optional — derived from manifest.yaml if present)
                </span>
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
              className={INPUT}
              disabled={submitting}
            />
          </div>
        )}

        <div>
          <label htmlFor="slug" className={LABEL}>
            Slug{" "}
            {!titleSlugDomainRequired && (
              <span className="text-ink-4 normal-case tracking-normal">
                (optional — derived from manifest.yaml if present)
              </span>
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
            className={`${INPUT} font-mono`}
            disabled={submitting}
          />
          <p className={HELP}>
            Lowercase letters, digits, and hyphens only. Auto-derived from the
            title; edit to override. Must be unique among your publisher&apos;s
            books.
          </p>
          {mode === "zip-file" && slugCheck.state === "exists" && (
            <div className="mt-3 bg-status-warn/10 border border-status-warn/30 p-3 text-sm text-status-warn">
              Slug <code className="font-mono text-ink-2">{slug}</code> exists —
              uploading creates{" "}
              <strong className="font-semibold">
                v{(slugCheck.latestVersion ?? 0) + 1}
              </strong>{" "}
              of &ldquo;<em className="font-serif">{slugCheck.title}</em>&rdquo;.
              {slugCheck.priceCents != null && (
                <>
                  {" "}
                  Price stays at{" "}
                  <strong className="font-semibold num tabular-nums">
                    ${(slugCheck.priceCents / 100).toFixed(2)}
                  </strong>
                  ; the price field below is locked and ignored on submit.
                </>
              )}
            </div>
          )}
          {mode === "zip-file" && slugCheck.state === "checking" && (
            <p className={HELP}>Checking slug…</p>
          )}
          {mode === "zip-file" && slugCheck.state === "error" && (
            <p className="font-mono text-[11px] text-status-err mt-1.5">{slugCheck.message}</p>
          )}
        </div>

        {showBookOnlyFields && (
          <>
            <div>
              <label htmlFor="domain" className={LABEL}>
                Domain{" "}
                {!titleSlugDomainRequired && (
                  <span className="text-ink-4 normal-case tracking-normal">
                    (optional — derived from manifest.yaml if present)
                  </span>
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
                className={INPUT}
                disabled={submitting}
              />
              <p className={HELP}>
                Free-text taxonomy tag (e.g. <code className="text-ink-2">skill</code>,{" "}
                <code className="text-ink-2">reference</code>,{" "}
                <code className="text-ink-2">playbook</code>).
              </p>
            </div>

            <div>
              <label htmlFor="description" className={LABEL}>
                Description{" "}
                <span className="text-ink-4 normal-case tracking-normal">
                  (optional, but recommended)
                </span>
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={5_000}
                rows={3}
                placeholder="Short prose summary buyers will see in the storefront."
                className={INPUT}
                disabled={submitting}
              />
              <p className={HELP}>
                {description.length} / 5000 chars. Empty descriptions render as
                &ldquo;No description yet.&rdquo;
              </p>
            </div>

            {/* PR 8 — typographic cover drivers. Replaces the cover-image
                upload from the prior PR. Palette + glyph persist on the
                Book row and drive the SVG cover server-side everywhere a
                cover renders. The live preview in the right rail updates
                as either changes. */}
            <section className="border-y border-rule -mx-8 px-8 py-5 bg-paper-2">
              <div className={LABEL}>Cover</div>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-4 mt-1">
                <div>
                  <label htmlFor="palette" className="font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 block mb-1.5">
                    Palette
                  </label>
                  <select
                    id="palette"
                    value={palette}
                    onChange={(e) => setPalette(e.target.value as BookCoverPalette)}
                    className={INPUT}
                    disabled={submitting}
                  >
                    {PALETTE_OPTIONS.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="glyph" className="font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 block mb-1.5">
                    Glyph
                  </label>
                  <input
                    id="glyph"
                    type="text"
                    value={glyph}
                    onChange={(e) => onGlyphChange(e.target.value)}
                    maxLength={1}
                    className={`${INPUT} font-serif italic text-center text-2xl`}
                    disabled={submitting}
                  />
                </div>
              </div>
              <p className={HELP}>
                Palette is the cover&apos;s color scheme. Glyph is the large
                italic letter — auto-derived from the title&apos;s first
                letter; edit to override. Preview updates live in the right
                rail.
              </p>
            </section>
          </>
        )}

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
            <label htmlFor="content" className={LABEL}>
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
              className={`${INPUT} font-mono`}
              disabled={submitting}
            />
            <p className={HELP}>
              Stored inline as the first version. Up to 1MB.
            </p>
          </div>
        )}

        {/* zip-file mode: the Stream K zip picker */}
        {mode === "zip-file" && (
          <div>
            <label className={LABEL}>Upload a .zip folder</label>
            {zipFile ? (
              <div className="flex items-start gap-4 p-4 bg-paper border border-rule">
                <span className="font-mono text-[10px] tracking-wider text-ink-3 bg-paper-2 border border-rule px-2 py-1 shrink-0">ZIP</span>
                <div className="flex flex-col gap-2 pt-0.5">
                  <p className="font-serif text-ink text-sm">{zipFile.name}</p>
                  <p className="font-mono text-[11px] text-ink-3">{(zipFile.size / 1024).toFixed(0)} KB</p>
                  <button
                    type="button"
                    onClick={removeZip}
                    disabled={submitting}
                    className="text-xs text-status-err hover:text-ink font-mono uppercase tracking-eyebrow text-left"
                  >
                    Clear file
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => !submitting && zipInputRef.current?.click()}
                className="border-2 border-dashed border-rule p-6 text-center cursor-pointer hover:border-ink hover:bg-paper-2 transition-colors bg-paper"
              >
                <span className="inline-block font-mono text-[10px] tracking-wider text-ink-3 bg-paper-2 border border-rule px-2 py-1 mb-3">ZIP</span>
                <p className="font-serif text-ink text-sm">Click to choose a .zip file</p>
                <p className="font-mono text-[11px] text-ink-3 mt-1">
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
            {zipError && <p className="font-mono text-[11px] text-status-err mt-1.5">{zipError}</p>}
          </div>
        )}

        <div>
          <label htmlFor="price" className={LABEL}>
            Price (USD){" "}
            {priceLockedToExisting && (
              <span className="text-ink-4 normal-case tracking-normal">
                (locked — new version of an existing book; price stays at the current value)
              </span>
            )}
          </label>
          <div className="flex items-center gap-2">
            <span className="text-ink-3 font-mono">$</span>
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
              className={`${INPUT} num tabular-nums`}
              disabled={submitting || priceLockedToExisting}
            />
          </div>
          <p className={HELP}>
            {priceLockedToExisting
              ? "Price changes happen on the pricing page, not on upload."
              : "Minimum $0.50 (Stripe USD floor). A fresh Stripe Price is created on submit."}
          </p>
        </div>

        {error && (
          <div className="bg-status-err/10 border border-status-err/30 text-status-err text-sm px-4 py-3">
            <div className="font-semibold mb-1">Failed to create book</div>
            <div>{error}</div>
            {stripeReconcile && (
              <div className="mt-2 text-xs font-mono">
                <span className="font-semibold">Stripe reconcile note:</span> {stripeReconcile}
              </div>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="bg-ink text-paper px-5 py-2.5 font-mono text-[11px] tracking-eyebrow uppercase hover:bg-ink-2 transition-colors disabled:opacity-50"
        >
          {submitLabel()}
        </button>
      </form>

      {/* PR 8 — live cover preview rail. Sticky on lg+ so the publisher
          sees the cover update as they type/select. Hidden in skill mode
          (skills don't have covers per Q4). */}
      {showCoverPreview && (
        <aside className="lg:sticky lg:top-12 self-start">
          <div className="font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 mb-3">
            § COVER PREVIEW
          </div>
          <div className="bg-paper border border-rule p-5">
            <BookCover book={previewBook} size="md" />
            <p className="font-mono text-[11px] text-ink-3 mt-4 leading-[1.55]">
              Updates as you type. Persists on the book row; renders the same
              SVG everywhere this book appears (storefront, library, billing,
              admin).
            </p>
          </div>
        </aside>
      )}
    </div>
  );
}
