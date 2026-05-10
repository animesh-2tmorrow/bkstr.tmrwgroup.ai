import Stripe from "stripe";

// Phase 3 Stream 3 — Stripe singleton.
// Mirrors the bedrock client shape (src/lib/bedrock.ts): module-level instance,
// dev-vs-prod global guard so HMR doesn't leak HTTP keep-alive sockets.
//
// Loud-warn-at-startup pattern (matches src/lib/auth/index.ts D1.7) so the
// "Stripe enabled in code but secrets not staged" failure mode is visible in
// pm2 logs, not silent. Operator stages /etc/bkstr/stripe.env (D9.4 / D10.3)
// before pm2 reload --update-env.
//
// apiVersion is pinned to the version the installed SDK's TypeScript types
// match (D9.5 — exact-pin Stripe SDK; "2026-04-22.dahlia" ships with
// stripe@22.1.1). Bumping the SDK and bumping apiVersion are deliberate PRs.
//
// Construction is lazy via a Proxy because Next.js's `next build` evaluates
// API route modules at compile time for static analysis — eager construction
// throws when STRIPE_SECRET_KEY isn't present at build time (operator stages
// it via SSM after the deploy lands). The Proxy materializes the real client
// only on first property access, by which time .env has been sourced.

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn(
    "[stripe] STRIPE_SECRET_KEY missing — Checkout, webhook signature verification, and any Stripe API call will fail until /etc/bkstr/stripe.env is sourced.",
  );
}
if (!process.env.STRIPE_WEBHOOK_SECRET) {
  console.warn(
    "[stripe] STRIPE_WEBHOOK_SECRET missing — incoming webhooks will reject with 400 (signature verification fail-closed).",
  );
}

const globalForStripe = globalThis as unknown as { stripeClient?: Stripe };

function makeStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set — stage /etc/bkstr/stripe.env before invoking Stripe APIs.",
    );
  }
  return new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
}

function getStripeClient(): Stripe {
  if (!globalForStripe.stripeClient) {
    globalForStripe.stripeClient = makeStripeClient();
  }
  return globalForStripe.stripeClient;
}

// Public surface: Proxy onto a deferred-instantiation Stripe client. Reads
// (e.g. `stripe.checkout.sessions.create(...)`) hit `get` → resolve the real
// client → forward. This keeps `import { stripe } from "@/lib/stripe"` shape
// while deferring construction to first call.
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    const client = getStripeClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
