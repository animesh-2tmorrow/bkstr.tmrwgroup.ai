import { describe, it, expect } from "vitest";
import { filterByRole } from "./filter-by-role";
import type { Role } from "@/generated/prisma/client";

// Phase 5 Stream A (D13.2) — unit coverage for filterByRole.
//
// Eight cases (a)-(h):
//   (a) ADMIN sees all tiers
//   (b) PUBLISHER sees publisher + subscriber + common, not admin
//   (c) SUBSCRIBER sees subscriber + common only
//   (d) Unknown role tag -> fail-closed for all roles
//   (e) Unterminated block -> fail-closed for all roles
//   (f) Spurious lone closing fence -> dropped silently, surrounding content preserved
//   (g) No role markers at all -> input passes through verbatim
//   (h) Empty input -> empty output

// Shared fixture for (a)/(b)/(c): one block per tier + common content above
// and below. Block markers should not appear in output; tier content is
// kept or removed based on the caller's rank.
const TIERED_INPUT = [
  "# Common heading",
  "common-1",
  "",
  ":::role admin",
  "admin-content-1",
  "admin-content-2",
  ":::",
  "",
  ":::role publisher",
  "publisher-content-1",
  ":::",
  "",
  ":::role subscriber",
  "subscriber-content-1",
  ":::",
  "",
  "common-2",
].join("\n");

describe("filterByRole", () => {
  it("(a) ADMIN sees all tiers + common; block-marker lines stripped", () => {
    const out = filterByRole(TIERED_INPUT, "ADMIN" as Role);
    expect(out).toContain("# Common heading");
    expect(out).toContain("common-1");
    expect(out).toContain("common-2");
    expect(out).toContain("admin-content-1");
    expect(out).toContain("admin-content-2");
    expect(out).toContain("publisher-content-1");
    expect(out).toContain("subscriber-content-1");
    // Block markers themselves must not appear in the rendered output.
    expect(out).not.toMatch(/:::role/);
    expect(out).not.toMatch(/^:::$/m);
  });

  it("(b) PUBLISHER sees publisher + subscriber + common, NOT admin", () => {
    const out = filterByRole(TIERED_INPUT, "PUBLISHER" as Role);
    expect(out).toContain("common-1");
    expect(out).toContain("common-2");
    expect(out).toContain("publisher-content-1");
    expect(out).toContain("subscriber-content-1");
    expect(out).not.toContain("admin-content-1");
    expect(out).not.toContain("admin-content-2");
    expect(out).not.toMatch(/:::role/);
  });

  it("(c) SUBSCRIBER sees subscriber + common only", () => {
    const out = filterByRole(TIERED_INPUT, "SUBSCRIBER" as Role);
    expect(out).toContain("common-1");
    expect(out).toContain("common-2");
    expect(out).toContain("subscriber-content-1");
    expect(out).not.toContain("admin-content-1");
    expect(out).not.toContain("admin-content-2");
    expect(out).not.toContain("publisher-content-1");
    expect(out).not.toMatch(/:::role/);
  });

  it("(d) Unknown role tag fail-closed: ALL roles see no content from the block", () => {
    const input = [
      "before",
      ":::role moderator",
      "SECRET",
      ":::",
      "after",
    ].join("\n");
    for (const role of ["SUBSCRIBER", "PUBLISHER", "ADMIN"] as Role[]) {
      const out = filterByRole(input, role);
      expect(out).not.toContain("SECRET");
      expect(out).toContain("before");
      expect(out).toContain("after");
    }
  });

  it("(e) Unterminated block fail-closed: even ADMIN sees no content from it", () => {
    const input = [
      "before",
      ":::role admin",
      "SECRET",
      // intentionally no closing :::
    ].join("\n");
    for (const role of ["SUBSCRIBER", "PUBLISHER", "ADMIN"] as Role[]) {
      const out = filterByRole(input, role);
      expect(out).not.toContain("SECRET");
      expect(out).toContain("before");
    }
  });

  it("(f) Spurious lone closing fence outside any block: dropped silently, surrounding content preserved", () => {
    const input = [
      "before",
      ":::",
      "after",
    ].join("\n");
    const out = filterByRole(input, "ADMIN" as Role);
    expect(out).toContain("before");
    expect(out).toContain("after");
    expect(out).not.toMatch(/^:::$/m);
  });

  it("(g) No role markers at all: output equals input verbatim", () => {
    const input = [
      "# Heading",
      "",
      "A paragraph.",
      "",
      "- bullet 1",
      "- bullet 2",
    ].join("\n");
    expect(filterByRole(input, "SUBSCRIBER" as Role)).toBe(input);
    expect(filterByRole(input, "PUBLISHER" as Role)).toBe(input);
    expect(filterByRole(input, "ADMIN" as Role)).toBe(input);
  });

  it("(h) Empty input -> empty output", () => {
    expect(filterByRole("", "SUBSCRIBER" as Role)).toBe("");
    expect(filterByRole("", "PUBLISHER" as Role)).toBe("");
    expect(filterByRole("", "ADMIN" as Role)).toBe("");
  });
});
