import { promises as fs } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { Role } from "@/generated/prisma/client";

// Docs registry — resolves the multi-page doc set under src/content/docs/.
// Each page is a markdown file with YAML frontmatter declaring its track,
// role-gate, and sort order. Pages are read at request time (the docs route
// is force-dynamic) so a role change takes effect without a redeploy.

const DOCS_DIR = path.join(process.cwd(), "src/content/docs");

// Tier ranks for the page-level role-gate. filter-by-role.ts holds the same
// map but does not export it, and lives outside this writing pass's editable
// surface — so the three-line map is restated here.
const ROLE_RANK: Record<string, number> = {
  SUBSCRIBER: 0,
  PUBLISHER: 1,
  ADMIN: 2,
};

export type DocTrack = "subscriber" | "agent" | "publisher" | "shared";

export interface DocMeta {
  slug: string;
  title: string;
  track: DocTrack;
  role: string; // minimum role to view — SUBSCRIBER means all signed-in users
  order: number;
  summary: string;
}

export interface DocPage extends DocMeta {
  body: string; // markdown with the frontmatter block stripped
}

export const TRACK_ORDER: DocTrack[] = [
  "subscriber",
  "agent",
  "publisher",
  "shared",
];

export const TRACK_LABEL: Record<DocTrack, string> = {
  subscriber: "Subscriber",
  agent: "Agent-developer",
  publisher: "Publisher",
  shared: "Reference",
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function parseDoc(slug: string, raw: string): DocPage {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    return {
      slug,
      title: slug,
      track: "shared",
      role: "SUBSCRIBER",
      order: 999,
      summary: "",
      body: raw,
    };
  }
  const fm = (parseYaml(match[1]) ?? {}) as Record<string, unknown>;
  const track = fm.track as DocTrack;
  return {
    slug,
    title: typeof fm.title === "string" ? fm.title : slug,
    track: TRACK_ORDER.includes(track) ? track : "shared",
    role: typeof fm.role === "string" ? fm.role.toUpperCase() : "SUBSCRIBER",
    order: typeof fm.order === "number" ? fm.order : 999,
    summary: typeof fm.summary === "string" ? fm.summary : "",
    body: match[2],
  };
}

export async function getAllDocs(): Promise<DocPage[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(DOCS_DIR);
  } catch {
    return [];
  }
  const docs: DocPage[] = [];
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const slug = name.replace(/\.md$/, "");
    const raw = await fs.readFile(path.join(DOCS_DIR, name), "utf8");
    docs.push(parseDoc(slug, raw));
  }
  return docs;
}

export async function getDoc(slug: string): Promise<DocPage | null> {
  // Reject anything that is not a plain slug — no path traversal.
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  try {
    const raw = await fs.readFile(path.join(DOCS_DIR, `${slug}.md`), "utf8");
    return parseDoc(slug, raw);
  } catch {
    return null;
  }
}

export function canView(doc: DocMeta, role: Role): boolean {
  const need = ROLE_RANK[doc.role] ?? 0;
  const have = ROLE_RANK[role] ?? -1;
  return have >= need;
}

// Visible pages grouped by track, in track order, each track sorted by `order`.
export function groupByTrack(
  docs: DocPage[],
  role: Role,
): { track: DocTrack; pages: DocMeta[] }[] {
  const visible = docs.filter((doc) => canView(doc, role));
  return TRACK_ORDER.map((track) => ({
    track,
    pages: visible
      .filter((doc) => doc.track === track)
      .sort((a, b) => a.order - b.order),
  })).filter((group) => group.pages.length > 0);
}
