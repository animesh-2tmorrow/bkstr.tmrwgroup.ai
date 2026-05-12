import { NextResponse } from "next/server";
import {
  findValidInvitationByToken,
  PENDING_INVITATION_COOKIE,
  PENDING_INVITATION_TTL_SECONDS,
} from "@/lib/admin/invitations";

// Phase 5 Stream E (D15.1) — invitation accept-init.
//
// POST sets the bkstr_pending_invitation cookie + redirects the browser to
// the NextAuth signin URL. The events.signIn hook reads the cookie after
// OAuth completes and applies the pre-assigned role.
//
// NO auth required — anyone with the magic link can hit this endpoint. The
// token is the auth (it's 256-bit unguessable per
// src/lib/admin/invitations.ts). Defense-in-depth: this handler validates
// the token BEFORE setting the cookie, so an invalid / expired / already-
// accepted token doesn't leak any state via the cookie set.
//
// The handler is POST-only because cookie-setting under the SameSite=Lax
// policy needs a same-origin form POST (the magic-link page renders an
// HTML form with method=POST; a GET wouldn't reliably set the cookie on
// the subsequent OAuth redirect, especially on Safari).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeRedirectPath(): string {
  // Always redirect to the canonical NextAuth signin page. The user picks
  // a Google account; OAuth completes; events.signIn applies the role.
  // We deliberately do NOT honor a `callbackUrl` query param here — open
  // redirect prevention.
  return "/api/auth/signin";
}

export async function POST(request: Request) {
  // Phase 5 Stream F — content-type dispatch instead of try-json-then-formData.
  // Per Fetch API, calling `request.json()` consumes the body stream even when
  // the parse fails and `.catch()` swallows the error; a subsequent
  // `request.formData()` then hits "Body has already been used" and yields no
  // fields. That broke the form-POST path from /invitations/accept (the only
  // production caller). Dispatching by Content-Type keeps both shapes
  // supported — form-encoded from the page, JSON from curl/test — without
  // double-consuming the body.
  let token: string | null = null;
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as { token?: unknown };
    if (typeof body.token === "string") token = body.token;
  } else {
    const form = await request.formData().catch(() => null);
    if (form) {
      const v = form.get("token");
      if (typeof v === "string") token = v;
    }
  }

  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  // Phase 5 Stream G — Next.js 15 App Router's `request.url` uses the
  // upstream listen address (e.g. localhost:3000) regardless of the
  // Host / X-Forwarded-Host headers, so it CAN'T be used as the base
  // for an absolute redirect behind a reverse proxy. The Location
  // header would point at the wrong origin and the browser would
  // either fail TLS handshake or land somewhere unreachable. Use
  // NEXTAUTH_URL — the canonical public origin already validated for
  // NextAuth's own callbacks. Hard-fail 500 if absent rather than
  // silently falling back to request.url (which is the broken path).
  const publicOrigin = process.env.NEXTAUTH_URL;
  if (!publicOrigin) {
    return NextResponse.json(
      { error: "NEXTAUTH_URL is not configured" },
      { status: 500 },
    );
  }

  // Validate BEFORE setting the cookie. An invalid token (expired,
  // already-accepted, never-existed) returns 400 with a clear error;
  // the cookie is never set so the subsequent OAuth flow can't pick up
  // a stale-and-invalid invitation.
  const invitation = await findValidInvitationByToken(token);
  if (!invitation) {
    return NextResponse.json(
      { error: "Invitation is invalid, expired, or already accepted" },
      { status: 400 },
    );
  }

  // Set the cookie + redirect to NextAuth signin. The
  // events.signIn hook in src/lib/auth/index.ts reads the cookie after
  // OAuth completes.
  const response = NextResponse.redirect(new URL(safeRedirectPath(), publicOrigin), {
    status: 303, // POST → GET redirect; browsers issue a GET for /api/auth/signin
  });
  response.cookies.set({
    name: PENDING_INVITATION_COOKIE,
    value: token,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: PENDING_INVITATION_TTL_SECONDS,
  });
  return response;
}
