// redesign(10)/3 — /skills/[slug] permanently redirects to /storefront/<slug>.
//
// The unified detail page at /storefront/[slug] resolves the slug to a
// book or skill via resolveSlug() and renders kind-aware. Old skill
// detail URLs (in Edward's send-package, in prior /skills HTML pages,
// in bookmarks) hit this redirect and land on the new surface.

import { permanentRedirect } from "next/navigation";

export default async function SkillDetailRedirect(props: {
  params: Promise<{ slug: string }>;
}): Promise<never> {
  const { slug } = await props.params;
  permanentRedirect(`/storefront/${slug}`);
}
