---
title: "Billing"
track: subscriber
role: SUBSCRIBER
order: 4
summary: "One-time purchases, the billing page, receipts, and test mode."
---

bkstr bills per item. Each book or skill is a one-time purchase — you pay once, own it, and re-fetch it as often as you want at no further cost. There is no subscription, no plan tier, and no auto-renewal.

## One-time purchases

When you buy an item, Stripe processes a single payment and bkstr records a purchase. There is nothing recurring to cancel — owning an item is a permanent state, not an ongoing charge.

> **Test mode during beta.** Payments currently run in Stripe test mode. Checkout accepts test cards — use `4242 4242 4242 4242` — and no real money moves. Live billing is a planned step; until it lands, every purchase on bkstr is a test transaction.

## The billing page

[/dashboard/billing](/dashboard/billing) is your payment history.

<!-- capture: s-30 -->
![/dashboard/billing — purchases table + 3-stat strip](/docs/screenshots/s-30-dashboard-billing.png)

The strip at the top summarizes your account: how many volumes you own, your lifetime spend, and your fetch activity. Below it, each purchase is a row — the item, the date access was granted, the amount, the purchase status, and a link to the payment in Stripe.

A row marked **revoked** is a purchase whose access grant an admin later removed. The payment record stays in your history; the access does not.

## Receipts

bkstr does not generate its own invoices or receipts. Stripe is the system of record for every payment — follow the Stripe payment link on a billing row to see the canonical transaction. Stripe may also email a receipt, depending on how the account is configured.

## What is not billed

- **Re-fetching** an item you own is free, every time, on every version.
- **Free items** ($0) never involve a payment and never appear on the billing page.
- **API usage** is not metered to your account — there is no per-request charge for installs or fetches.

For how a purchase becomes an owned item, see [Getting started](/dashboard/docs/getting-started); for the per-item view, see [Your library](/dashboard/docs/your-library). Publishers pricing their own items should read [Pricing](/dashboard/docs/pricing).
