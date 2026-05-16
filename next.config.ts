import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        // bkstr S3 bucket for publisher-uploaded book cover images.
        // Bucket: bkstr-tmrw-prod (us-east-1)
        // Key pattern: book-covers/<bookId>.<ext>
        protocol: "https",
        hostname: "bkstr-tmrw-prod.s3.us-east-1.amazonaws.com",
        pathname: "/book-covers/**",
      },
    ],
  },
};

// monitoring(1a) — wrap with withSentryConfig to enable build-time
// sourcemap upload, so production stack traces resolve to readable
// source instead of minified bundle frames.
//
// Only the options confirmed valid for @sentry/nextjs v10 are passed.
// The dispatch's example also listed `hideSourceMaps`, `disableLogger`,
// and `automaticVercelMonitors` — dropped: `hideSourceMaps` was removed
// in SDK v8 (sourcemaps are hidden by default now), `disableLogger` is
// not in the v10 documented option set, and `automaticVercelMonitors`
// defaults to off (bkstr is not on Vercel). Passing an unknown option
// would fail the typecheck during `next build`.
export default withSentryConfig(nextConfig, {
  // Sourcemap upload target. org/project are non-secret; the auth token
  // is a build-time-only secret supplied to CodeBuild via buildspec
  // env/parameter-store (SSM SecureString). When the token is absent
  // (e.g. a local build), the Sentry plugin skips sourcemap upload and
  // the build still succeeds.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Quiet local builds. CodeBuild sets CI=true, so the prod build stays
  // verbose for log inspection.
  silent: !process.env.CI,

  // Upload all client bundle files so minified client stack frames
  // resolve fully.
  widenClientFileUpload: true,

  // Route Sentry event ingestion through a same-origin path so ad
  // blockers don't drop client-side error events.
  tunnelRoute: "/monitoring",
});
