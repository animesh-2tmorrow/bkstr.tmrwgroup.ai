---
title: "Pricing"
track: publisher
role: PUBLISHER
order: 3
summary: "Set and change a book's price, and how bkstr keeps Stripe in sync."
---

Every book and skill on bkstr is sold for a one-time price in US dollars. This page covers setting and changing a book's price from the [Pricing](/dashboard/pricing) page.

## The Pricing page

[/dashboard/pricing](/dashboard/pricing) lists the books you have published, each with its current price and a control to change it. As a publisher you see your own books; an admin sees every book.

<!-- capture: p-11 -->
![Pricing page — the publisher's catalog list (publisher-scoped)](/docs/screenshots/p-11-pricing-list.png)

## Setting a price

Pick a book, enter a new price in dollars, and save.

<!-- capture: p-12 -->
![Pricing — editor with a book selected and a new price typed (pre-save)](/docs/screenshots/p-12-pricing-edit.png)

The minimum price is **$0.50** — the floor the payment processor enforces for US-dollar charges. There is no maximum. bkstr has no free-item authoring path: every book and skill you create through the dashboard has a price of at least $0.50.

A price change takes effect immediately. It does not require re-publishing or re-uploading the book's content.

<!-- capture: p-13 -->
![Pricing page after a re-price — new price + Stripe Price on the row](/docs/screenshots/p-13-pricing-saved.png)

## How Stripe stays in sync

bkstr handles the payment processor for you. When you create a book, bkstr creates the matching Stripe product and price. When you change a price, bkstr creates a fresh Stripe price and points the book at it — Stripe prices are immutable, so a change is always a new price record, not an edit.

You do not manage anything in Stripe directly. Setting the dollar amount on the Pricing page is the whole job.

## What a publisher owns

Publishing a book gives you a grant on it — you own your own content. On its storefront page your book shows the owned state, the same **Get started** panel a buyer sees, so you can install and test it exactly as a reader would.

<!-- capture: p-17 -->
![Owned-state /storefront/[slug] for a publisher-owned book](/docs/screenshots/p-17-owned-state-publisher-item.png)

## Revenue

A per-publisher sales and revenue view is not available yet. It is a planned addition; this page will cover it when it ships.
