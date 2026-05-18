---
title: "Authoring books"
track: publisher
role: PUBLISHER
order: 1
summary: "Create a book by pasting markdown or uploading a multi-chapter .zip."
---

A book is a bundle of markdown your readers' agents read as context. As a publisher, you create one from [/dashboard/books/new](/dashboard/books/new). This page covers both ways to do that — pasting markdown and uploading a multi-chapter `.zip`.

The New Book form is the only authoring surface. There is no separate books index and no per-book edit page.

<!-- capture: p-01 -->
![Dashboard for a publisher account — sidebar shows New Book / Pricing / Admin](/docs/screenshots/p-01-publisher-dashboard.png)

## The form

Every book takes the same fields, whichever upload mode you use:

- **Title** — 1 to 255 characters.
- **Slug** — 1 to 128 characters; lowercase letters, digits, and hyphens only. Auto-derived from the title until you edit it; must be unique within your account.
- **Domain** — a short free-text category (for example `reference` or `runbook`), used as a storefront filter.
- **Description** — up to 5000 characters. Optional, but it is what buyers read in the catalog. Front-load the important part; the catalog truncates long descriptions.
- **Content** — the book body. Required.
- **Price** — US dollars, minimum $0.50. See [Pricing](/dashboard/docs/pricing).

<!-- capture: p-02 -->
![New Book form, paste mode, empty](/docs/screenshots/p-02-new-book-paste-empty.png)

## Paste mode

For a single-document book, choose the paste mode and paste markdown straight into the **Content** field. Standard markdown renders — headings, code blocks, tables, lists, links.

<!-- capture: p-03 -->
![New Book form, paste mode, filled from docs-capture sample content](/docs/screenshots/p-03-new-book-paste-filled.png)

When you submit, bkstr creates the Stripe product for the book, then writes the book, its first version, its price, and your publisher grant in one transaction. The book is live on its storefront page immediately.

<!-- capture: p-04 -->
![Paste-mode book published — live on its storefront page](/docs/screenshots/p-04-new-book-paste-success.png)

## Upload a .zip — multi-chapter books

For a book that spans several chapters, switch the upload mode to **Upload a .zip folder**.

<!-- capture: p-05 -->
![New Book form, zip-upload mode, empty](/docs/screenshots/p-05-new-book-zip-empty.png)

What goes in the zip:

- **Chapter files** — one `.md` or `.markdown` file per chapter, typically under a `chapters/` directory.
- **An optional `manifest.yaml` at the zip root.** If present, it declares the ordered chapter list and book-level metadata. Its one required field is `chapters:`, a non-empty ordered list. With no manifest, bkstr derives the chapter order from the filenames.

A manifest chapter entry accepts a `file:` path, a `slug:`, or both:

```yaml
chapters:
  - file: chapters/ch00-core.md
  - slug: appendix-a
  - file: chapters/ch01-intro.md
    slug: introduction
```

<!-- capture: p-06 -->
![New Book zip mode, multi-chapter-book.zip selected](/docs/screenshots/p-06-new-book-zip-selected.png)

A few rules the zip path enforces:

- **Wrapping is transparent.** If your zip wraps everything in a single top-level folder — the usual result of compressing a folder — bkstr detects the wrapper and treats its contents as the root. Up to three levels of single-folder nesting are unwrapped. macOS `__MACOSX/` entries are dropped.
- **Caps:** the zip is at most 10 MB; each chapter at most 1 MB; the uncompressed total at most 20 MB; at most 500 chapters.
- **Re-uploading is idempotent.** An identical re-upload returns the existing version unchanged. A zip with edited content creates the next version (v2, v3, and so on) of the same book.
- **Skill bundles are rejected.** A zip whose root holds a `SKILL.md` is refused by the book path — to publish a skill, see [Authoring skills](/dashboard/docs/authoring-skills).

The published book is live on its storefront page right away.

<!-- capture: p-07 -->
![Zip-mode book published — live on its storefront page](/docs/screenshots/p-07-new-book-zip-success.png)

## After you publish

A submitted book is live the moment the form succeeds — it appears in the catalog's Browse tab for every signed-in subscriber. There is no preview step.

Two things to know before you submit:

- **Proof your content first.** Whatever you submit, buyers see right away. Preview your markdown in your own editor before you paste or zip it.
- **Only the price is editable later.** Once a book is published, the title, slug, description, domain, and content cannot be changed from the dashboard — only the price, on the [Pricing](/dashboard/docs/pricing) page. Decide the title and slug, and proofread the content, before you submit.

To re-price, archive, or check the catalog ledger, see [Pricing](/dashboard/docs/pricing) and [Catalog management](/dashboard/docs/catalog-management).
