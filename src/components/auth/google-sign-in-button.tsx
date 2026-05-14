"use client";

import { signIn } from "next-auth/react";

// bkstr redesign PR 2 — restyle to match the new design system. Square
// corners, paper bg + ink border (ghost variant of the design Button),
// no shadow. Logo SVG preserved verbatim (Google brand requires the
// 4-color mark — `currentColor` would lose the brand). Auth flow is
// unchanged: clicking still hits next-auth `signIn("google")` with the
// dashboard as the callback.

export function GoogleSignInButton({
  label,
  callbackUrl = "/dashboard",
}: {
  label: string;
  callbackUrl?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => signIn("google", { callbackUrl })}
      className={
        "w-full inline-flex items-center justify-center gap-3 " +
        "px-[18px] py-2.5 text-sm font-medium font-sans " +
        // Ghost-button shape from the design system — bg-paper + ink
        // border, hover flips to ink-on-paper. Square corners explicit.
        "rounded-none border border-ink bg-paper text-ink " +
        "hover:bg-ink hover:text-paper " +
        "transition-[background-color,color,border-color] duration-150 " +
        "active:translate-y-px disabled:opacity-50"
      }
    >
      {/* Google brand mark — keep the 4-color hex values per brand
          guidelines; do NOT recolor to ink (would dilute the recognized
          mark). 16×16 to match the dispatch's reference auth.jsx:36-43. */}
      <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
        <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
        <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" />
        <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 000 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" />
        <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z" />
      </svg>
      {label}
    </button>
  );
}
