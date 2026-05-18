import Link from "next/link";
import type { Role } from "@/generated/prisma/client";
import type { DocPage } from "../_lib/docs";
import { groupByTrack, TRACK_LABEL } from "../_lib/docs";

// In-docs navigation rail — tracks and their pages, role-filtered, with the
// current page emphasised. Rendered alongside the article on every doc page.
export function DocsNav({
  docs,
  role,
  current,
}: {
  docs: DocPage[];
  role: Role;
  current?: string;
}) {
  const groups = groupByTrack(docs, role);
  return (
    <nav className="text-sm">
      {groups.map((group) => (
        <div key={group.track} className="mb-5">
          <div className="font-mono text-[11px] tracking-[1.5px] text-ink-3 uppercase mb-1.5">
            {TRACK_LABEL[group.track]}
          </div>
          <ul className="space-y-1">
            {group.pages.map((page) => (
              <li key={page.slug}>
                <Link
                  href={`/dashboard/docs/${page.slug}`}
                  className={
                    page.slug === current
                      ? "block text-ink font-medium"
                      : "block text-ink-2 hover:text-ink"
                  }
                >
                  {page.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
