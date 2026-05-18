---
title: "Catalog management"
track: publisher
role: PUBLISHER
order: 4
summary: "Archive and unarchive a book, and where to find the catalog ledger."
---

Once a book is published it stays in the catalog until you archive it. This page covers archiving — taking a book out of circulation — and where the catalog ledger lives.

## Archiving a book

Archiving removes a book from the places people browse: the storefront, the catalog grid, and `bkstr list`. It does not delete the book, and it does not touch access — anyone who already owns the book keeps it and can still install it.

You archive a book from its row on the [Pricing](/dashboard/pricing) page. Because archiving changes what buyers can find, the confirmation asks you to type the book's slug — a deliberate guard against an accidental archive.

<!-- capture: p-14 -->
![Archive confirmation dialog — the book slug must be typed to confirm](/docs/screenshots/p-14-archive-confirm-dialog.png)

Once confirmed, the book drops out of the catalog.

<!-- capture: p-15 -->
![Pricing list after archiving the docs-capture-bash-aliases book](/docs/screenshots/p-15-archive-post-state.png)

Archiving is reversible — unarchiving a book returns it to the catalog with its price and content intact.

## The catalog ledger

Admins can see every book on the platform, across all publishers, on the catalog ledger at `/dashboard/admin/books`. It is the full ownership record — which publisher each book belongs to — and the surface for reassigning a book to a different publisher.

<!-- capture: p-16 -->
![Admin catalog ledger /dashboard/admin/books (non-test data redacted)](/docs/screenshots/p-16-admin-books-ledger.png)

The catalog ledger is admin-only. As a publisher, the [Pricing](/dashboard/pricing) page is your view of your own books.
