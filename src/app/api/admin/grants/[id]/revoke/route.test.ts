import { describe, it, expect, vi, beforeEach } from "vitest";

// Stream V (D19.x) — admin grant revoke self-protection tests.
// Four cases:
//   V-1  own PUBLISHER_OWN → 409 SELF_PROTECTION; ZERO audit rows written
//        (TX-rollback invariant — load-bearing per dispatch §A directive)
//   V-2  other publisher's PUBLISHER_OWN → 200 (admin can still revoke
//        OTHER publishers' grants; Stream F decision intact)
//   V-3  own PURCHASE → 200 (gate only applies to PUBLISHER_OWN source)
//   V-4  non-ADMIN → 403 (regression check on the existing admin-only gate)
//
// Mocks: auth() + prisma.$transaction's inner tx. The TX runner just
// invokes the callback with a tx-shaped mock so the handler's three tx
// calls (findUnique, update, writeAuditEntry → tx.adminAction.create) are
// individually observable. The audit-row write goes through
// writeAuditEntry, which we DON'T mock — we let the real implementation
// call tx.adminAction.create on the mocked tx, so the audit-call count is
// the source of truth for V-1.

const authMock = vi.fn<() => Promise<unknown>>();
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));

const txAccessGrantFindUniqueMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const txAccessGrantUpdateMock = vi.fn<(arg: unknown) => Promise<unknown>>();
const txAdminActionCreateMock = vi.fn<(arg: unknown) => Promise<unknown>>();

const transactionMock = vi.fn(async (arg: unknown) => {
  if (typeof arg === "function") {
    const tx = {
      accessGrant: {
        findUnique: (a: unknown) => txAccessGrantFindUniqueMock(a),
        update: (a: unknown) => txAccessGrantUpdateMock(a),
      },
      adminAction: {
        create: (a: unknown) => txAdminActionCreateMock(a),
      },
    };
    return (arg as (tx: unknown) => Promise<unknown>)(tx);
  }
  throw new Error("Unexpected $transaction shape in test");
});

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: (a: unknown) => transactionMock(a),
  },
}));

import { POST } from "./route";

const ACTOR_USER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_USER_ID = "22222222-2222-2222-2222-222222222222";
const GRANT_ID = "33333333-3333-3333-3333-333333333333";
const SUBSCRIBER_ID = "44444444-4444-4444-4444-444444444444";
const OTHER_SUBSCRIBER_ID = "55555555-5555-5555-5555-555555555555";
const BOOK_ID = "66666666-6666-6666-6666-666666666666";

const ADMIN_SESSION = {
  user: { id: ACTOR_USER_ID, email: "admin@example.com", role: "ADMIN" },
};

const PUBLISHER_SESSION = {
  user: { id: ACTOR_USER_ID, email: "pub@example.com", role: "PUBLISHER" },
};

function makeRequest(): Request {
  return new Request(`http://localhost/api/admin/grants/${GRANT_ID}/revoke`, {
    method: "POST",
  });
}

function makeContext(grantId = GRANT_ID) {
  return { params: Promise.resolve({ id: grantId }) };
}

beforeEach(() => {
  authMock.mockReset();
  txAccessGrantFindUniqueMock.mockReset();
  txAccessGrantUpdateMock.mockReset();
  txAdminActionCreateMock.mockReset();
  transactionMock.mockClear();
});

describe("POST /api/admin/grants/[id]/revoke — Stream V self-protection", () => {
  it("(V-1) own PUBLISHER_OWN → 409 SELF_PROTECTION; ZERO audit rows written (TX-rollback invariant)", async () => {
    authMock.mockResolvedValue(ADMIN_SESSION);
    // Subscriber.userId equals session.user.id → self-protection trigger.
    txAccessGrantFindUniqueMock.mockResolvedValue({
      id: GRANT_ID,
      source: "PUBLISHER_OWN",
      revokedAt: null,
      subscriberId: SUBSCRIBER_ID,
      bookId: BOOK_ID,
      subscriber: { userId: ACTOR_USER_ID },
    });

    const res = await POST(makeRequest(), makeContext());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("SELF_PROTECTION");
    expect(body.error).toMatch(/PUBLISHER_OWN grant/);

    // Load-bearing assertion per dispatch lock #2 — the gate fires INSIDE
    // the TX before any write, so the TX rolls back with zero writes in
    // either access_grants OR admin_actions. Call counts on the mocked tx
    // methods are the in-memory proxy for "rows touched."
    expect(txAccessGrantUpdateMock).not.toHaveBeenCalled();
    expect(txAdminActionCreateMock).not.toHaveBeenCalled();
    // Sanity: the read DID happen (so we know the gate isn't short-circuiting
    // before the lookup). 1 read, 0 writes.
    expect(txAccessGrantFindUniqueMock).toHaveBeenCalledOnce();
  });

  it("(V-2) other publisher's PUBLISHER_OWN → 200 (admin revokes another's grant; Stream F intact)", async () => {
    authMock.mockResolvedValue(ADMIN_SESSION);
    txAccessGrantFindUniqueMock.mockResolvedValue({
      id: GRANT_ID,
      source: "PUBLISHER_OWN",
      revokedAt: null,
      subscriberId: OTHER_SUBSCRIBER_ID,
      bookId: BOOK_ID,
      // Different user → no self-protection.
      subscriber: { userId: OTHER_USER_ID },
    });
    txAccessGrantUpdateMock.mockResolvedValue({ id: GRANT_ID });
    txAdminActionCreateMock.mockResolvedValue({ id: "audit-1" });

    const res = await POST(makeRequest(), makeContext());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(GRANT_ID);
    expect(body.source).toBe("PUBLISHER_OWN");

    // Normal flow: 1 read, 1 update, 1 audit row.
    expect(txAccessGrantUpdateMock).toHaveBeenCalledOnce();
    expect(txAdminActionCreateMock).toHaveBeenCalledOnce();
    // Audit row carries the expected action_type for D12.5 compliance.
    const auditCall = txAdminActionCreateMock.mock.calls[0][0] as {
      data: { actionType: string; targetType: string; targetId: string };
    };
    expect(auditCall.data.actionType).toBe("grant.revoke");
    expect(auditCall.data.targetType).toBe("grant");
    expect(auditCall.data.targetId).toBe(GRANT_ID);
  });

  it("(V-3) own PURCHASE grant → 200 (gate is PUBLISHER_OWN-only)", async () => {
    authMock.mockResolvedValue(ADMIN_SESSION);
    txAccessGrantFindUniqueMock.mockResolvedValue({
      id: GRANT_ID,
      source: "PURCHASE",
      revokedAt: null,
      subscriberId: SUBSCRIBER_ID,
      bookId: BOOK_ID,
      // Same actor — but the source is PURCHASE, so the gate doesn't fire.
      // An admin buying their own book via Stripe is a real flow (e.g. a
      // test purchase the admin made on their own account); revoking it
      // shouldn't be blocked.
      subscriber: { userId: ACTOR_USER_ID },
    });
    txAccessGrantUpdateMock.mockResolvedValue({ id: GRANT_ID });
    txAdminActionCreateMock.mockResolvedValue({ id: "audit-2" });

    const res = await POST(makeRequest(), makeContext());
    expect(res.status).toBe(200);
    expect(txAccessGrantUpdateMock).toHaveBeenCalledOnce();
    expect(txAdminActionCreateMock).toHaveBeenCalledOnce();
  });

  it("(V-4) non-ADMIN → 403 (regression check on the existing admin-only gate)", async () => {
    authMock.mockResolvedValue(PUBLISHER_SESSION);

    const res = await POST(makeRequest(), makeContext());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("ADMIN only");
    // Auth gate fires before the TX even opens.
    expect(transactionMock).not.toHaveBeenCalled();
    expect(txAccessGrantFindUniqueMock).not.toHaveBeenCalled();
  });
});
