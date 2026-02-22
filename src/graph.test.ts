import { describe, expect, it } from "vitest";
import {
  addLink,
  removeLink,
  getLinks,
  applyMatches,
  deserializeBacklinks,
  serializeBacklinks,
  createEmptyBacklinksIndex,
  rebuildBacklinks,
} from "./graph";
import type { BacklinksIndex } from "@/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyIndex(): BacklinksIndex {
  return createEmptyBacklinksIndex();
}

// ---------------------------------------------------------------------------
// getLinks
// ---------------------------------------------------------------------------

describe("getLinks", () => {
  it("returns empty array for unknown note", () => {
    const index = emptyIndex();
    expect(getLinks(index, "note-1")).toEqual([]);
  });

  it("returns links for a known note", () => {
    const index: BacklinksIndex = {
      links: { "note-1": [{ targetId: "note-2", similarity: 0.9 }] },
    };
    expect(getLinks(index, "note-1")).toEqual([
      { targetId: "note-2", similarity: 0.9 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// addLink
// ---------------------------------------------------------------------------

describe("addLink", () => {
  it("adds a bidirectional link", () => {
    const index = emptyIndex();
    addLink(index, "note-a", "note-b", 0.85);

    expect(index.links["note-a"]).toEqual([
      { targetId: "note-b", similarity: 0.85 },
    ]);
    expect(index.links["note-b"]).toEqual([
      { targetId: "note-a", similarity: 0.85 },
    ]);
  });

  it("updates similarity when link already exists", () => {
    const index = emptyIndex();
    addLink(index, "note-a", "note-b", 0.85);
    addLink(index, "note-a", "note-b", 0.92);

    expect(index.links["note-a"]).toHaveLength(1);
    expect(index.links["note-a"][0].similarity).toBe(0.92);
    expect(index.links["note-b"]).toHaveLength(1);
    expect(index.links["note-b"][0].similarity).toBe(0.92);
  });

  it("does nothing when linking a note to itself", () => {
    const index = emptyIndex();
    addLink(index, "note-a", "note-a", 1.0);

    expect(index.links["note-a"]).toBeUndefined();
  });

  it("supports multiple links from the same note", () => {
    const index = emptyIndex();
    addLink(index, "note-a", "note-b", 0.85);
    addLink(index, "note-a", "note-c", 0.90);

    expect(index.links["note-a"]).toHaveLength(2);
    expect(index.links["note-b"]).toHaveLength(1);
    expect(index.links["note-c"]).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// removeLink
// ---------------------------------------------------------------------------

describe("removeLink", () => {
  it("removes a bidirectional link", () => {
    const index = emptyIndex();
    addLink(index, "note-a", "note-b", 0.85);
    removeLink(index, "note-a", "note-b");

    expect(index.links["note-a"]).toBeUndefined();
    expect(index.links["note-b"]).toBeUndefined();
  });

  it("does nothing when link does not exist", () => {
    const index = emptyIndex();
    removeLink(index, "note-x", "note-y");

    expect(Object.keys(index.links)).toHaveLength(0);
  });

  it("preserves other links when removing one", () => {
    const index = emptyIndex();
    addLink(index, "note-a", "note-b", 0.85);
    addLink(index, "note-a", "note-c", 0.90);
    removeLink(index, "note-a", "note-b");

    expect(index.links["note-a"]).toEqual([
      { targetId: "note-c", similarity: 0.90 },
    ]);
    expect(index.links["note-b"]).toBeUndefined();
    expect(index.links["note-c"]).toEqual([
      { targetId: "note-a", similarity: 0.90 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// applyMatches
// ---------------------------------------------------------------------------

describe("applyMatches", () => {
  it("adds links from similarity matches", () => {
    const index = emptyIndex();
    applyMatches(index, "note-a", [
      { targetId: "note-b", similarity: 0.85 },
      { targetId: "note-c", similarity: 0.90 },
    ]);

    expect(index.links["note-a"]).toHaveLength(2);
    expect(index.links["note-b"]).toHaveLength(1);
    expect(index.links["note-c"]).toHaveLength(1);
  });

  it("updates existing links with new similarity", () => {
    const index = emptyIndex();
    addLink(index, "note-a", "note-b", 0.80);
    applyMatches(index, "note-a", [
      { targetId: "note-b", similarity: 0.95 },
    ]);

    expect(index.links["note-a"]).toHaveLength(1);
    expect(index.links["note-a"][0].similarity).toBe(0.95);
  });
});

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

describe("serializeBacklinks", () => {
  it("produces valid JSON with trailing newline", () => {
    const index = emptyIndex();
    addLink(index, "note-a", "note-b", 0.85);

    const json = serializeBacklinks(index);

    expect(json.endsWith("\n")).toBe(true);
    expect(JSON.parse(json)).toEqual(index);
  });
});

describe("deserializeBacklinks", () => {
  it("parses a JSON string", () => {
    const data: BacklinksIndex = {
      links: { "note-a": [{ targetId: "note-b", similarity: 0.9 }] },
    };
    const result = deserializeBacklinks(JSON.stringify(data));

    expect(result).toEqual(data);
  });

  it("returns empty index for null input", () => {
    expect(deserializeBacklinks(null)).toEqual({ links: {} });
  });

  it("returns empty index for empty string", () => {
    expect(deserializeBacklinks("")).toEqual({ links: {} });
  });
});

// ---------------------------------------------------------------------------
// rebuildBacklinks
// ---------------------------------------------------------------------------

describe("rebuildBacklinks", () => {
  it("builds a complete bidirectional index from pairs", () => {
    const index = rebuildBacklinks([
      { noteA: "n1", noteB: "n2", similarity: 0.85 },
      { noteA: "n1", noteB: "n3", similarity: 0.90 },
      { noteA: "n2", noteB: "n3", similarity: 0.88 },
    ]);

    expect(index.links["n1"]).toHaveLength(2);
    expect(index.links["n2"]).toHaveLength(2);
    expect(index.links["n3"]).toHaveLength(2);
  });

  it("returns empty index for no pairs", () => {
    const index = rebuildBacklinks([]);
    expect(index).toEqual({ links: {} });
  });
});
