// redesign(10)/3 — /skills permanently redirects to /storefront.
//
// Books + skills now live in one catalog. The /skills route is retained
// as a 308 redirect so external links (Edward's send-package, prior
// docs, bookmarks) continue to land somewhere sensible. Phase 5 may
// delete this file outright once enough time has passed for inbound
// links to update; for now the redirect is a defensive courtesy.

import { permanentRedirect } from "next/navigation";

export default function SkillsListingPage(): never {
  permanentRedirect("/storefront");
}
