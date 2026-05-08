"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function RefreshButton({ label = "Refresh" }: { label?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={isPending}
      className="bg-black text-[#FAF6EC] px-4 py-2 rounded-lg text-sm font-bold hover:bg-black disabled:opacity-50 shadow-sm"
    >
      {isPending ? "Refreshing…" : label}
    </button>
  );
}
