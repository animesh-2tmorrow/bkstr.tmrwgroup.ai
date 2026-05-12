import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Phase 5 Stream F — regression test for the body-consumption fix.
//
// Pre-fix: the route called `request.json()` first, which consumed the
// body stream even when the parse failed (Fetch API spec). The
// subsequent `request.formData()` then yielded null and the route
// returned 400 "token is required" — breaking the only production
// caller (the /invitations/accept page's HTML form POST).
//
// Post-fix: content-type dispatch. JSON requests use json(),
// form-encoded requests use formData(). Body is consumed exactly once
// in either branch.
//
// These tests pin that invariant. If a future refactor reverts to the
// sequential try-json-then-formData pattern, the form-POST test fails
// loudly.

const findValidInvitationByTokenMock = vi.fn<(t: string) => Promise<unknown>>();

vi.mock("@/lib/admin/invitations", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin/invitations")>(
    "@/lib/admin/invitations",
  );
  return {
    ...actual,
    findValidInvitationByToken: (t: string) => findValidInvitationByTokenMock(t),
  };
});

import { POST } from "./route";
import { PENDING_INVITATION_COOKIE } from "@/lib/admin/invitations";

const VALID_TOKEN = "valid-plaintext-token-fixture";
const VALID_INVITATION = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "recipient@example.com",
  role: "PUBLISHER",
  tokenHash: "ignored-by-mock",
  expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  acceptedAt: null,
};

// Stream G — fix the redirect-origin bug where `request.url` (Next.js's
// upstream listen address, e.g. localhost:3000) was used as the base
// for the Location header. Replaced with process.env.NEXTAUTH_URL.
// G-1/G-2 pin the new contract; F-1 tightened from a loose `endsWith`
// match (which passed against the buggy localhost Location) to exact
// origin equality + explicit `not.toContain("localhost")`.

const TEST_NEXTAUTH_URL = "https://bkstr.tmrwgroup.ai";
let originalNextAuthUrl: string | undefined;

beforeEach(() => {
  findValidInvitationByTokenMock.mockReset();
  originalNextAuthUrl = process.env.NEXTAUTH_URL;
  process.env.NEXTAUTH_URL = TEST_NEXTAUTH_URL;
});

afterEach(() => {
  if (originalNextAuthUrl === undefined) {
    delete process.env.NEXTAUTH_URL;
  } else {
    process.env.NEXTAUTH_URL = originalNextAuthUrl;
  }
});

describe("accept-init route — body consumption + redirect origin", () => {
  it("(F-1) form-encoded POST extracts token and 303-redirects to NEXTAUTH_URL with cookie", async () => {
    findValidInvitationByTokenMock.mockResolvedValue(VALID_INVITATION);

    const body = new URLSearchParams({ token: VALID_TOKEN }).toString();
    const req = new Request("http://localhost/api/invitations/accept-init", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });

    const res = await POST(req);

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${TEST_NEXTAUTH_URL}/api/auth/signin`);
    expect(res.headers.get("location")).not.toContain("localhost");

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${PENDING_INVITATION_COOKIE}=${VALID_TOKEN}`);
    expect(setCookie).toMatch(/httponly/i);
    expect(setCookie).toMatch(/secure/i);
    expect(setCookie).toMatch(/samesite=lax/i);

    expect(findValidInvitationByTokenMock).toHaveBeenCalledWith(VALID_TOKEN);
  });

  it("(F-2) JSON POST still works (curl/test path)", async () => {
    findValidInvitationByTokenMock.mockResolvedValue(VALID_INVITATION);

    const req = new Request("http://localhost/api/invitations/accept-init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: VALID_TOKEN }),
    });

    const res = await POST(req);

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${TEST_NEXTAUTH_URL}/api/auth/signin`);
    expect(findValidInvitationByTokenMock).toHaveBeenCalledWith(VALID_TOKEN);
  });

  it("(F-3) form-encoded POST with no token returns 400", async () => {
    const req = new Request("http://localhost/api/invitations/accept-init", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/token is required/i);
    expect(findValidInvitationByTokenMock).not.toHaveBeenCalled();
  });

  it("(F-4) form-encoded POST with invalid token returns 400 (no cookie)", async () => {
    findValidInvitationByTokenMock.mockResolvedValue(null);

    const body = new URLSearchParams({ token: "expired-or-bogus" }).toString();
    const req = new Request("http://localhost/api/invitations/accept-init", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/invalid|expired|already accepted/i);
    expect(res.headers.get("set-cookie")).toBeFalsy();
  });

  it("(G-1) Location uses NEXTAUTH_URL host, NOT request.url host", async () => {
    process.env.NEXTAUTH_URL = "https://prod.example.com";
    findValidInvitationByTokenMock.mockResolvedValue(VALID_INVITATION);

    // Request URL deliberately uses a DIFFERENT host (mimicking Next.js's
    // upstream listen address behind a reverse proxy). If the fix
    // regresses to `request.url`, the Location will leak the internal
    // host and this test fails.
    const body = new URLSearchParams({ token: VALID_TOKEN }).toString();
    const req = new Request("http://upstream-internal.local:3000/api/invitations/accept-init", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });

    const res = await POST(req);

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://prod.example.com/api/auth/signin");
    expect(res.headers.get("location")).not.toContain("upstream-internal");
    expect(res.headers.get("location")).not.toContain(":3000");
  });

  it("(G-2) missing NEXTAUTH_URL returns 500 (fail-loud, not a broken redirect)", async () => {
    delete process.env.NEXTAUTH_URL;
    findValidInvitationByTokenMock.mockResolvedValue(VALID_INVITATION);

    const body = new URLSearchParams({ token: VALID_TOKEN }).toString();
    const req = new Request("http://localhost/api/invitations/accept-init", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/NEXTAUTH_URL/i);
    expect(res.headers.get("set-cookie")).toBeFalsy();
  });
});
