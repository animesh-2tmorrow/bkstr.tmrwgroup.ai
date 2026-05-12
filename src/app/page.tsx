import { redirect } from "next/navigation";

// Phase 5 Stream H.1 (D15.7) — root route redirects to the ecommerce storefront.
// Edward's direction: storefront-first framing for the public homepage. The
// marketing landing (hero / compression pipeline explainer / pricing tiers /
// registry highlights) moved to `/about` — preserved verbatim, with a
// "Browse books" CTA so visitors who want context can still find the catalog.
//
// The redirect runs server-side at request time (Next.js `redirect()` throws
// a NEXT_REDIRECT in the React Server Component, the framework's redirect
// boundary catches it and emits an HTTP 307). No client JS / no flash.

export default function Home() {
  redirect("/storefront");
}
