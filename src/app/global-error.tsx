"use client";

// monitoring(1a) — root-level error boundary.
//
// Next.js renders this only when the ROOT LAYOUT itself throws — the one
// error class a route-level error.tsx cannot catch (the layout never
// mounted, so there is no layout-scoped boundary). It must be a client
// component and must render its own <html>/<body>.
//
// Not in the dispatch's file list, but part of the v10 Sentry setup:
// without it, a root-layout crash bypasses Sentry entirely. The fallback
// UI is deliberately minimal — this path should fire approximately never,
// and it renders with no access to the app's fonts/CSS (the layout that
// loads them is what crashed).

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "Georgia, 'Times New Roman', serif",
          background: "#F4EFE5",
          color: "#161613",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <h1 style={{ fontWeight: 400, fontSize: "1.75rem", margin: "0 0 0.5rem" }}>
            Something went wrong.
          </h1>
          <p style={{ color: "#6B6963", margin: "0 0 1.25rem" }}>
            The error has been logged. Try reloading the page.
          </p>
          <a
            href="/"
            style={{
              color: "#161613",
              textDecoration: "underline",
              textUnderlineOffset: "4px",
            }}
          >
            Return home
          </a>
        </div>
      </body>
    </html>
  );
}
