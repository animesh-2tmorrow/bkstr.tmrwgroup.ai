import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 6 Stream J (D16.1) — getVersionContent: the single read path for a
// BookVersion's content. Legacy single-blob versions (no chapters) delegate to
// loadBookContent (the D9.2 dual-storage seam); multi-chapter versions assemble
// their chapters' content in `order`, joined by a blank line. Four tests per
// the Gate 2 spec.

const loadBookContentMock = vi.fn<(arg: unknown) => Promise<string>>();

vi.mock("@/lib/storage/book-content", () => ({
  loadBookContent: (arg: unknown) => loadBookContentMock(arg),
}));

import { getVersionContent } from "./content";

beforeEach(() => {
  loadBookContentMock.mockReset();
});

describe("getVersionContent", () => {
  it("delegates to loadBookContent when the version has no chapters", async () => {
    loadBookContentMock.mockResolvedValue("RESOLVED VIA SEAM");
    const out = await getVersionContent({
      id: "v-legacy",
      bookId: "b1",
      content: "inline blob",
      contentUri: "inline://v-legacy",
      chapters: [],
    });
    expect(out).toBe("RESOLVED VIA SEAM");
    expect(loadBookContentMock).toHaveBeenCalledTimes(1);
    expect(loadBookContentMock).toHaveBeenCalledWith(expect.objectContaining({ id: "v-legacy" }));
  });

  it("assembles chapter content joined by a blank line, never touching the storage seam", async () => {
    const out = await getVersionContent({
      id: "v-multi",
      bookId: "b1",
      content: null,
      contentUri: "inline://v-multi",
      chapters: [
        { order: 0, content: "# Chapter zero" },
        { order: 1, content: "# Chapter one" },
        { order: 2, content: "# Chapter two" },
      ],
    });
    expect(out).toBe("# Chapter zero\n\n# Chapter one\n\n# Chapter two");
    expect(loadBookContentMock).not.toHaveBeenCalled();
  });

  it("returns chapters by `order`, not by insertion order", async () => {
    const out = await getVersionContent({
      id: "v-shuffled",
      bookId: "b1",
      content: null,
      contentUri: "inline://v-shuffled",
      chapters: [
        { order: 2, content: "third" },
        { order: 0, content: "first" },
        { order: 1, content: "second" },
      ],
    });
    expect(out).toBe("first\n\nsecond\n\nthird");
    expect(loadBookContentMock).not.toHaveBeenCalled();
  });

  it("throws a descriptive error when a chapter row has empty content", async () => {
    await expect(
      getVersionContent({
        id: "v-bad",
        bookId: "b1",
        content: null,
        contentUri: "inline://v-bad",
        chapters: [
          { order: 0, content: "ok" },
          { order: 1, content: "" },
        ],
      }),
    ).rejects.toThrow(/book_version v-bad chapter order=1 has empty content/);
    expect(loadBookContentMock).not.toHaveBeenCalled();
  });
});
