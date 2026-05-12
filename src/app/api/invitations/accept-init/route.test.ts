import { describe, it, expect, vi, beforeEach } from "vitest";

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

beforeEach(() => {
  findValidInvitationByTokenMock.mockReset();
});

describe("accept-init route — body consumption", () => {
  it("(F-1) form-encoded POST extracts token and 303-redirects with cookie", async () => {
    findValidInvitationByTokenMock.mockResolvedValue(VALID_INVITATION);

    const body = new URLSearchParams({ token: VALID_TOKEN }).toString();
    const req = new Request("http://localhost/api/invitations/accept-init", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });

    const res = await POST(req);

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/\/api\/auth\/signin$/);

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
});
