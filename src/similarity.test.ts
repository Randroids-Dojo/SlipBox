import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  findMatches,
  matchesToLinks,
} from "./similarity";
import type { EmbeddingsIndex } from "@/types";

// ---------------------------------------------------------------------------
// cosineSimilarity
// ---------------------------------------------------------------------------

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 10);
  });

  it("returns -1 for opposite vectors", () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 10);
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 10);
  });

  it("computes correct similarity for known vectors", () => {
    // cos(45°) ≈ 0.7071
    const a = [1, 0];
    const b = [1, 1];
    const expected = 1 / Math.sqrt(2);
    expect(cosineSimilarity(a, b)).toBeCloseTo(expected, 10);
  });

  it("is independent of vector magnitude", () => {
    const a = [1, 2, 3];
    const b = [2, 4, 6]; // same direction, 2x magnitude
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 10);
  });

  it("throws on length mismatch", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(
      "Vector length mismatch: 2 vs 3",
    );
  });

  it("throws on empty vectors", () => {
    expect(() => cosineSimilarity([], [])).toThrow(
      "Cannot compute similarity of empty vectors",
    );
  });

  it("throws on zero magnitude vector", () => {
    expect(() => cosineSimilarity([0, 0, 0], [1, 2, 3])).toThrow(
      "Cannot compute similarity: zero magnitude vector",
    );
  });
});

// ---------------------------------------------------------------------------
// findMatches
// ---------------------------------------------------------------------------

describe("findMatches", () => {
  // Build a small index with known vectors
  const index: EmbeddingsIndex = {
    embeddings: {
      "20260101T000000-aaaaaaaa": {
        noteId: "20260101T000000-aaaaaaaa",
        vector: [1, 0, 0],
        model: "test",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      "20260102T000000-bbbbbbbb": {
        noteId: "20260102T000000-bbbbbbbb",
        vector: [0.95, 0.31, 0], // ~cos similarity to [1,0,0] ≈ 0.95
        model: "test",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
      "20260103T000000-cccccccc": {
        noteId: "20260103T000000-cccccccc",
        vector: [0, 1, 0], // orthogonal to [1,0,0] → similarity 0
        model: "test",
        createdAt: "2026-01-03T00:00:00.000Z",
      },
      "20260104T000000-dddddddd": {
        noteId: "20260104T000000-dddddddd",
        vector: [0.9, 0.44, 0], // ~cos similarity to [1,0,0] ≈ 0.899
        model: "test",
        createdAt: "2026-01-04T00:00:00.000Z",
      },
    },
  };

  const target = [1, 0, 0];

  it("returns matches above the threshold, sorted descending", () => {
    // At 0.85 threshold: aaaaaaaa (1.0), bbbbbbbb (~0.95), dddddddd (~0.90) match
    const matches = findMatches(target, index, 0.85);
    expect(matches).toHaveLength(3);
    expect(matches[0].noteId).toBe("20260101T000000-aaaaaaaa");
    expect(matches[0].similarity).toBeCloseTo(1.0, 5);
    expect(matches[1].noteId).toBe("20260102T000000-bbbbbbbb");
    expect(matches[1].similarity).toBeGreaterThanOrEqual(0.85);
    expect(matches[2].noteId).toBe("20260104T000000-dddddddd");
    expect(matches[2].similarity).toBeGreaterThanOrEqual(0.85);
  });

  it("excludes specified note IDs", () => {
    const matches = findMatches(
      target,
      index,
      0.85,
      new Set(["20260101T000000-aaaaaaaa"]),
    );
    expect(matches).toHaveLength(2);
    expect(matches[0].noteId).toBe("20260102T000000-bbbbbbbb");
    expect(matches[1].noteId).toBe("20260104T000000-dddddddd");
  });

  it("returns empty array when no matches exceed threshold", () => {
    const matches = findMatches(target, index, 0.999);
    // Only the identical vector (1,0,0) should match at ~1.0
    expect(matches).toHaveLength(1);
    expect(matches[0].noteId).toBe("20260101T000000-aaaaaaaa");
  });

  it("returns empty array for an empty index", () => {
    const emptyIndex: EmbeddingsIndex = { embeddings: {} };
    const matches = findMatches(target, emptyIndex, 0.5);
    expect(matches).toHaveLength(0);
  });

  it("uses a lower threshold to include more matches", () => {
    const matches = findMatches(target, index, 0.5);
    // Should include aaaaaaaa (1.0), bbbbbbbb (~0.95), dddddddd (~0.90)
    // but not cccccccc (0.0)
    expect(matches).toHaveLength(3);
    expect(matches.map((m) => m.noteId)).not.toContain(
      "20260103T000000-cccccccc",
    );
  });

  it("results are sorted from highest to lowest similarity", () => {
    const matches = findMatches(target, index, 0.0);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].similarity).toBeGreaterThanOrEqual(
        matches[i].similarity,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// matchesToLinks
// ---------------------------------------------------------------------------

describe("matchesToLinks", () => {
  it("converts matches to NoteLink objects", () => {
    const matches = [
      { noteId: "20260101T000000-aaaaaaaa", similarity: 0.95 },
      { noteId: "20260102T000000-bbbbbbbb", similarity: 0.88 },
    ];

    const links = matchesToLinks(matches);

    expect(links).toEqual([
      { targetId: "20260101T000000-aaaaaaaa", similarity: 0.95 },
      { targetId: "20260102T000000-bbbbbbbb", similarity: 0.88 },
    ]);
  });

  it("returns empty array for no matches", () => {
    expect(matchesToLinks([])).toEqual([]);
  });
});
