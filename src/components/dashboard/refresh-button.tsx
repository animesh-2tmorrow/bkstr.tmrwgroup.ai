"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

// bkstr redesign PR 7 — restyled with design tokens. Mono uppercase label
// matching every other primary CTA in the dashboard.
export function RefreshButton({ label = "Refresh" }: { label?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={isPending}
      className="bg-ink text-paper px-4 py-2 font-mono text-[11px] tracking-eyebrow uppercase hover:bg-ink-2 disabled:opacity-50 transition-colors"
    >
      {isPending ? "Refreshing…" : label}
    </button>
  );
}
