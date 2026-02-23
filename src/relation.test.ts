import { describe, expect, it } from "vitest";
import {
  canonicalKey,
  isValidRelationType,
  upsertRelation,
  getRelationsForNote,
  emptyRelationsIndex,
} from "./relation";

// ---------------------------------------------------------------------------
// canonicalKey
// ---------------------------------------------------------------------------

describe("canonicalKey", () => {
  it("puts the lexicographically smaller ID first", () => {
    expect(canonicalKey("note-b", "note-a")).toBe("note-a:note-b");
  });

  it("is stable when called with IDs already in order", () => {
    expect(canonicalKey("note-a", "note-b")).toBe("note-a:note-b");
  });

  it("produces the same key regardless of argument order", () => {
    expect(canonicalKey("note-x", "note-m")).toBe(
      canonicalKey("note-m", "note-x"),
    );
  });

  it("handles equal IDs without throwing", () => {
    expect(canonicalKey("note-a", "note-a")).toBe("note-a:note-a");
  });

  it("uses lexicographic (not length-based) ordering", () => {
    // "note-10" < "note-9" lexicographically
    expect(canonicalKey("note-9", "note-10")).toBe("note-10:note-9");
  });
});

// ---------------------------------------------------------------------------
// isValidRelationType
// ---------------------------------------------------------------------------

describe("isValidRelationType", () => {
  it("accepts all valid relation types", () => {
    const valid = [
      "supports",
      "contradicts",
      "refines",
      "is-example-of",
      "contrasts-with",
    ];
    for (const t of valid) {
      expect(isValidRelationType(t)).toBe(true);
    }
  });

  it("rejects unknown strings", () => {
    expect(isValidRelationType("unknown")).toBe(false);
    expect(isValidRelationType("")).toBe(false);
    expect(isValidRelationType("SUPPORTS")).toBe(false);
    expect(isValidRelationType("support")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// upsertRelation
// ---------------------------------------------------------------------------

describe("upsertRelation", () => {
  it("inserts a new relation with canonical key", () => {
    const index = emptyRelationsIndex();
    upsertRelation(index, "note-b", "note-a", "supports", "A supports B", 0.9);

    const key = "note-a:note-b";
    expect(index.relations[key]).toBeDefined();
    expect(index.relations[key].noteA).toBe("note-a");
    expect(index.relations[key].noteB).toBe("note-b");
  });

  it("stores relationType, reason, and similarity", () => {
    const index = emptyRelationsIndex();
    upsertRelation(
      index,
      "note-a",
      "note-b",
      "contradicts",
      "They conflict on X",
      0.75,
    );

    const link = index.relations["note-a:note-b"];
    expect(link.relationType).toBe("contradicts");
    expect(link.reason).toBe("They conflict on X");
    expect(link.similarity).toBeCloseTo(0.75);
  });

  it("overwrites an existing relation for the same pair", () => {
    const index = emptyRelationsIndex();
    upsertRelation(index, "note-a", "note-b", "supports", "First reason", 0.9);
    upsertRelation(
      index,
      "note-a",
      "note-b",
      "contradicts",
      "Second reason",
      0.85,
    );

    expect(Object.keys(index.relations)).toHaveLength(1);
    expect(index.relations["note-a:note-b"].relationType).toBe("contradicts");
    expect(index.relations["note-a:note-b"].reason).toBe("Second reason");
  });

  it("overwrites regardless of argument order", () => {
    const index = emptyRelationsIndex();
    upsertRelation(index, "note-a", "note-b", "supports", "r1", 0.9);
    upsertRelation(index, "note-b", "note-a", "refines", "r2", 0.88);

    expect(Object.keys(index.relations)).toHaveLength(1);
    expect(index.relations["note-a:note-b"].relationType).toBe("refines");
  });

  it("refreshes updatedAt on every upsert", () => {
    const index = emptyRelationsIndex();
    const before = index.updatedAt;
    upsertRelation(index, "note-a", "note-b", "supports", "r", 0.9);

    // updatedAt should be at least as recent as before
    expect(new Date(index.updatedAt) >= new Date(before)).toBe(true);
  });

  it("uses provided classifiedAt timestamp", () => {
    const index = emptyRelationsIndex();
    const ts = "2026-01-01T00:00:00.000Z";
    upsertRelation(index, "note-a", "note-b", "supports", "r", 0.9, ts);

    expect(index.relations["note-a:note-b"].classifiedAt).toBe(ts);
  });

  it("defaults classifiedAt to current time when omitted", () => {
    const before = Date.now();
    const index = emptyRelationsIndex();
    upsertRelation(index, "note-a", "note-b", "supports", "r", 0.9);
    const after = Date.now();

    const ts = new Date(
      index.relations["note-a:note-b"].classifiedAt,
    ).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("can store multiple distinct pairs", () => {
    const index = emptyRelationsIndex();
    upsertRelation(index, "note-a", "note-b", "supports", "r1", 0.9);
    upsertRelation(index, "note-b", "note-c", "refines", "r2", 0.88);
    upsertRelation(index, "note-a", "note-c", "contradicts", "r3", 0.7);

    expect(Object.keys(index.relations)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// getRelationsForNote
// ---------------------------------------------------------------------------

describe("getRelationsForNote", () => {
  it("returns an empty array when the note has no relations", () => {
    const index = emptyRelationsIndex();
    upsertRelation(index, "note-a", "note-b", "supports", "r", 0.9);

    expect(getRelationsForNote(index, "note-z")).toHaveLength(0);
  });

  it("returns relations where the note is noteA", () => {
    const index = emptyRelationsIndex();
    upsertRelation(index, "note-a", "note-b", "supports", "r", 0.9);

    const results = getRelationsForNote(index, "note-a");
    expect(results).toHaveLength(1);
    expect(results[0].noteA).toBe("note-a");
  });

  it("returns relations where the note is noteB", () => {
    const index = emptyRelationsIndex();
    upsertRelation(index, "note-a", "note-b", "supports", "r", 0.9);

    const results = getRelationsForNote(index, "note-b");
    expect(results).toHaveLength(1);
    expect(results[0].noteB).toBe("note-b");
  });

  it("returns all relations involving the note across multiple pairs", () => {
    const index = emptyRelationsIndex();
    upsertRelation(index, "note-a", "note-b", "supports", "r1", 0.9);
    upsertRelation(index, "note-a", "note-c", "contradicts", "r2", 0.7);
    upsertRelation(index, "note-b", "note-c", "refines", "r3", 0.85);

    const results = getRelationsForNote(index, "note-a");
    expect(results).toHaveLength(2);
  });

  it("returns an empty array for an empty index", () => {
    const index = emptyRelationsIndex();
    expect(getRelationsForNote(index, "note-a")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// emptyRelationsIndex
// ---------------------------------------------------------------------------

describe("emptyRelationsIndex", () => {
  it("produces an index with no relations", () => {
    const index = emptyRelationsIndex();
    expect(Object.keys(index.relations)).toHaveLength(0);
  });

  it("sets updatedAt to a valid ISO timestamp", () => {
    const index = emptyRelationsIndex();
    expect(() => new Date(index.updatedAt)).not.toThrow();
    expect(new Date(index.updatedAt).toISOString()).toBe(index.updatedAt);
  });

  it("each call returns an independent object", () => {
    const a = emptyRelationsIndex();
    const b = emptyRelationsIndex();
    upsertRelation(a, "note-a", "note-b", "supports", "r", 0.9);

    expect(Object.keys(b.relations)).toHaveLength(0);
  });
});
