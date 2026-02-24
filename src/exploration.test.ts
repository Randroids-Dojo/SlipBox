import { describe, expect, it } from "vitest";
import { detectExplorations } from "./exploration";
import type {
  EmbeddingsIndex,
  BacklinksIndex,
  ClustersIndex,
  RelationsIndex,
} from "@/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEmbeddings(
  ids: string[],
  vectors?: Record<string, number[]>,
): EmbeddingsIndex {
  const embeddings: EmbeddingsIndex["embeddings"] = {};
  for (const id of ids) {
    embeddings[id] = {
      noteId: id,
      vector: vectors?.[id] ?? [1, 0, 0],
      model: "test",
      createdAt: "t",
    };
  }
  return { embeddings };
}

function makeBacklinks(
  links: Record<string, string[]>,
): BacklinksIndex {
  const result: BacklinksIndex["links"] = {};
  for (const [noteId, targets] of Object.entries(links)) {
    result[noteId] = targets.map((targetId) => ({
      targetId,
      similarity: 0.9,
      createdAt: "t",
    }));
  }
  return { links: result };
}

function makeClusters(
  clusters: Array<{ id: string; centroid: number[]; noteIds: string[] }>,
): ClustersIndex {
  const result: ClustersIndex["clusters"] = {};
  for (const c of clusters) {
    result[c.id] = {
      id: c.id,
      centroid: c.centroid,
      noteIds: c.noteIds,
      createdAt: "t",
      updatedAt: "t",
    };
  }
  return { clusters: result, computedAt: "t" };
}

function makeRelations(
  pairs: Array<{ noteA: string; noteB: string }>,
): RelationsIndex {
  const relations: RelationsIndex["relations"] = {};
  for (const { noteA, noteB } of pairs) {
    const key = `${noteA}:${noteB}`;
    relations[key] = {
      noteA,
      noteB,
      relationType: "supports",
      reason: "test",
      similarity: 0.9,
      classifiedAt: "t",
    };
  }
  return { relations, updatedAt: "t" };
}

const emptyEmbeddings = makeEmbeddings([]);
const emptyBacklinks = makeBacklinks({});
const emptyClusters = makeClusters([]);
const emptyRelations = makeRelations([]);

// ---------------------------------------------------------------------------
// Orphan-note detection
// ---------------------------------------------------------------------------

describe("detectExplorations — orphan-note", () => {
  it("flags notes with zero backlinks", () => {
    const embeddings = makeEmbeddings(["a", "b", "c"]);
    const backlinks = makeBacklinks({ b: ["a"], a: ["b"] }); // c has no links

    const result = detectExplorations(
      embeddings,
      backlinks,
      emptyClusters,
      emptyRelations,
    );

    const orphans = result.suggestions.filter((s) => s.type === "orphan-note");
    expect(orphans).toHaveLength(1);
    expect(orphans[0].noteId).toBe("c");
  });

  it("flags all notes when backlinks index is empty", () => {
    const embeddings = makeEmbeddings(["a", "b"]);

    const result = detectExplorations(
      embeddings,
      emptyBacklinks,
      emptyClusters,
      emptyRelations,
    );

    const orphans = result.suggestions.filter((s) => s.type === "orphan-note");
    expect(orphans).toHaveLength(2);
    const noteIds = orphans.map((s) => s.noteId).sort();
    expect(noteIds).toEqual(["a", "b"]);
  });

  it("produces no orphan suggestions when all notes have links", () => {
    const embeddings = makeEmbeddings(["a", "b"]);
    const backlinks = makeBacklinks({ a: ["b"], b: ["a"] });

    const result = detectExplorations(
      embeddings,
      backlinks,
      emptyClusters,
      emptyRelations,
    );

    const orphans = result.suggestions.filter((s) => s.type === "orphan-note");
    expect(orphans).toHaveLength(0);
  });

  it("produces no orphan suggestions when embeddings index is empty", () => {
    const result = detectExplorations(
      emptyEmbeddings,
      emptyBacklinks,
      emptyClusters,
      emptyRelations,
    );

    expect(result.suggestions).toHaveLength(0);
  });

  it("includes orphan-note noteId in suggestion", () => {
    const embeddings = makeEmbeddings(["note-x"]);

    const result = detectExplorations(
      embeddings,
      emptyBacklinks,
      emptyClusters,
      emptyRelations,
    );

    expect(result.suggestions[0].noteId).toBe("note-x");
    expect(result.suggestions[0].type).toBe("orphan-note");
  });
});

// ---------------------------------------------------------------------------
// Close-clusters detection
// ---------------------------------------------------------------------------

describe("detectExplorations — close-clusters", () => {
  it("flags cluster pairs with centroid similarity above threshold", () => {
    // Very similar centroids — cos sim ≈ 1.0
    const clusters = makeClusters([
      { id: "c1", centroid: [1, 0, 0], noteIds: ["a"] },
      { id: "c2", centroid: [0.999, 0.045, 0], noteIds: ["b"] },
    ]);

    const result = detectExplorations(
      emptyEmbeddings,
      emptyBacklinks,
      clusters,
      emptyRelations,
      { closeClusterThreshold: 0.85 },
    );

    const close = result.suggestions.filter((s) => s.type === "close-clusters");
    expect(close).toHaveLength(1);
    expect(close[0].clusterA).toBeDefined();
    expect(close[0].clusterB).toBeDefined();
    expect(close[0].similarity).toBeGreaterThan(0.85);
  });

  it("does not flag cluster pairs with centroids below threshold", () => {
    // Orthogonal centroids — cos sim = 0.0
    const clusters = makeClusters([
      { id: "c1", centroid: [1, 0, 0], noteIds: ["a"] },
      { id: "c2", centroid: [0, 1, 0], noteIds: ["b"] },
    ]);

    const result = detectExplorations(
      emptyEmbeddings,
      emptyBacklinks,
      clusters,
      emptyRelations,
      { closeClusterThreshold: 0.85 },
    );

    const close = result.suggestions.filter((s) => s.type === "close-clusters");
    expect(close).toHaveLength(0);
  });

  it("stores clusterA < clusterB in canonical order", () => {
    const clusters = makeClusters([
      { id: "z-cluster", centroid: [1, 0, 0], noteIds: ["a"] },
      { id: "a-cluster", centroid: [0.999, 0.045, 0], noteIds: ["b"] },
    ]);

    const result = detectExplorations(
      emptyEmbeddings,
      emptyBacklinks,
      clusters,
      emptyRelations,
      { closeClusterThreshold: 0.85 },
    );

    const close = result.suggestions.filter((s) => s.type === "close-clusters");
    expect(close).toHaveLength(1);
    expect(close[0].clusterA).toBe("a-cluster");
    expect(close[0].clusterB).toBe("z-cluster");
  });

  it("checks all pairs in an n-cluster graph", () => {
    // Three similar clusters — should produce 3 pair suggestions
    const clusters = makeClusters([
      { id: "c1", centroid: [1, 0, 0], noteIds: ["a"] },
      { id: "c2", centroid: [0.999, 0.045, 0], noteIds: ["b"] },
      { id: "c3", centroid: [0.998, 0.063, 0], noteIds: ["c"] },
    ]);

    const result = detectExplorations(
      emptyEmbeddings,
      emptyBacklinks,
      clusters,
      emptyRelations,
      { closeClusterThreshold: 0.85 },
    );

    const close = result.suggestions.filter((s) => s.type === "close-clusters");
    expect(close).toHaveLength(3);
  });

  it("produces no close-cluster suggestions with a single cluster", () => {
    const clusters = makeClusters([
      { id: "c1", centroid: [1, 0, 0], noteIds: ["a"] },
    ]);

    const result = detectExplorations(
      emptyEmbeddings,
      emptyBacklinks,
      clusters,
      emptyRelations,
    );

    const close = result.suggestions.filter((s) => s.type === "close-clusters");
    expect(close).toHaveLength(0);
  });

  it("uses configured threshold", () => {
    // cos sim ≈ 0.9 (not > 0.95 but > 0.85)
    const clusters = makeClusters([
      { id: "c1", centroid: [1, 0, 0], noteIds: ["a"] },
      { id: "c2", centroid: [0.9, 0.436, 0], noteIds: ["b"] }, // sim ≈ 0.9
    ]);

    const noFlag = detectExplorations(
      emptyEmbeddings,
      emptyBacklinks,
      clusters,
      emptyRelations,
      { closeClusterThreshold: 0.95 },
    );
    expect(
      noFlag.suggestions.filter((s) => s.type === "close-clusters"),
    ).toHaveLength(0);

    const flagged = detectExplorations(
      emptyEmbeddings,
      emptyBacklinks,
      clusters,
      emptyRelations,
      { closeClusterThreshold: 0.85 },
    );
    expect(
      flagged.suggestions.filter((s) => s.type === "close-clusters"),
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Structural-hole detection
// ---------------------------------------------------------------------------

describe("detectExplorations — structural-hole", () => {
  it("flags clusters with no typed relations to external notes", () => {
    const clusters = makeClusters([
      { id: "c1", centroid: [1, 0, 0], noteIds: ["a", "b"] },
      { id: "c2", centroid: [0, 1, 0], noteIds: ["c", "d"] },
    ]);
    // Only internal relation within c1
    const relations = makeRelations([{ noteA: "a", noteB: "b" }]);

    const result = detectExplorations(
      emptyEmbeddings,
      emptyBacklinks,
      clusters,
      relations,
    );

    const holes = result.suggestions.filter((s) => s.type === "structural-hole");
    expect(holes).toHaveLength(2); // both clusters are isolated
    const clusterIds = holes.map((s) => s.clusterId).sort();
    expect(clusterIds).toEqual(["c1", "c2"]);
  });

  it("does not flag a cluster with an external relation", () => {
    const clusters = makeClusters([
      { id: "c1", centroid: [1, 0, 0], noteIds: ["a", "b"] },
      { id: "c2", centroid: [0, 1, 0], noteIds: ["c", "d"] },
    ]);
    // Cross-cluster relation between c1 (note-a) and c2 (note-c)
    const relations = makeRelations([{ noteA: "a", noteB: "c" }]);

    const result = detectExplorations(
      emptyEmbeddings,
      emptyBacklinks,
      clusters,
      relations,
    );

    const holes = result.suggestions.filter((s) => s.type === "structural-hole");
    // Both c1 and c2 benefit from this cross-cluster relation
    expect(holes).toHaveLength(0);
  });

  it("flags all clusters when relations index is empty", () => {
    const clusters = makeClusters([
      { id: "c1", centroid: [1, 0, 0], noteIds: ["a"] },
      { id: "c2", centroid: [0, 1, 0], noteIds: ["b"] },
    ]);

    const result = detectExplorations(
      emptyEmbeddings,
      emptyBacklinks,
      clusters,
      emptyRelations,
    );

    const holes = result.suggestions.filter((s) => s.type === "structural-hole");
    expect(holes).toHaveLength(2);
  });

  it("produces no structural-hole suggestions when no clusters exist", () => {
    const result = detectExplorations(
      emptyEmbeddings,
      emptyBacklinks,
      emptyClusters,
      emptyRelations,
    );

    const holes = result.suggestions.filter((s) => s.type === "structural-hole");
    expect(holes).toHaveLength(0);
  });

  it("includes clusterId in suggestion", () => {
    const clusters = makeClusters([
      { id: "isolated-cluster", centroid: [1, 0, 0], noteIds: ["a"] },
    ]);

    const result = detectExplorations(
      emptyEmbeddings,
      emptyBacklinks,
      clusters,
      emptyRelations,
    );

    const hole = result.suggestions.find((s) => s.type === "structural-hole");
    expect(hole?.clusterId).toBe("isolated-cluster");
  });
});

// ---------------------------------------------------------------------------
// Meta-note-missing detection
// ---------------------------------------------------------------------------

describe("detectExplorations — meta-note-missing", () => {
  it("flags clusters with no meta note", () => {
    const clusters = makeClusters([
      { id: "c1", centroid: [1, 0, 0], noteIds: ["a", "b"] },
      { id: "c2", centroid: [0, 1, 0], noteIds: ["c", "d"] },
    ]);
    const metaNoteIds = new Set(["a"]); // only c1 has a meta note

    const result = detectExplorations(
      emptyEmbeddings,
      emptyBacklinks,
      clusters,
      emptyRelations,
      { metaNoteIds },
    );

    const missing = result.suggestions.filter(
      (s) => s.type === "meta-note-missing",
    );
    expect(missing).toHaveLength(1);
    expect(missing[0].clusterId).toBe("c2");
  });

  it("does not flag clusters that have a meta note", () => {
    const clusters = makeClusters([
      { id: "c1", centroid: [1, 0, 0], noteIds: ["a", "b"] },
    ]);
    const metaNoteIds = new Set(["b"]); // b is meta

    const result = detectExplorations(
      emptyEmbeddings,
      emptyBacklinks,
      clusters,
      emptyRelations,
      { metaNoteIds },
    );

    const missing = result.suggestions.filter(
      (s) => s.type === "meta-note-missing",
    );
    expect(missing).toHaveLength(0);
  });

  it("skips meta-note-missing check when metaNoteIds is not provided", () => {
    const clusters = makeClusters([
      { id: "c1", centroid: [1, 0, 0], noteIds: ["a"] },
    ]);

    const result = detectExplorations(
      emptyEmbeddings,
      emptyBacklinks,
      clusters,
      emptyRelations,
      // no metaNoteIds
    );

    const missing = result.suggestions.filter(
      (s) => s.type === "meta-note-missing",
    );
    expect(missing).toHaveLength(0);
  });

  it("flags all clusters when metaNoteIds set is empty", () => {
    const clusters = makeClusters([
      { id: "c1", centroid: [1, 0, 0], noteIds: ["a"] },
      { id: "c2", centroid: [0, 1, 0], noteIds: ["b"] },
    ]);

    const result = detectExplorations(
      emptyEmbeddings,
      emptyBacklinks,
      clusters,
      emptyRelations,
      { metaNoteIds: new Set() },
    );

    const missing = result.suggestions.filter(
      (s) => s.type === "meta-note-missing",
    );
    expect(missing).toHaveLength(2);
  });

  it("recognizes meta notes that are in the middle of the noteIds list", () => {
    const clusters = makeClusters([
      { id: "c1", centroid: [1, 0, 0], noteIds: ["a", "meta-1", "b"] },
    ]);
    const metaNoteIds = new Set(["meta-1"]);

    const result = detectExplorations(
      emptyEmbeddings,
      emptyBacklinks,
      clusters,
      emptyRelations,
      { metaNoteIds },
    );

    const missing = result.suggestions.filter(
      (s) => s.type === "meta-note-missing",
    );
    expect(missing).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Output shape and metadata
// ---------------------------------------------------------------------------

describe("detectExplorations — output shape", () => {
  it("returns suggestions array and computedAt", () => {
    const result = detectExplorations(
      emptyEmbeddings,
      emptyBacklinks,
      emptyClusters,
      emptyRelations,
    );

    expect(Array.isArray(result.suggestions)).toBe(true);
    expect(typeof result.computedAt).toBe("string");
    expect(result.computedAt).toBeTruthy();
  });

  it("assigns unique IDs to each suggestion", () => {
    const embeddings = makeEmbeddings(["a", "b", "c"]);
    const clusters = makeClusters([
      { id: "c1", centroid: [1, 0, 0], noteIds: ["a"] },
      { id: "c2", centroid: [0.999, 0.045, 0], noteIds: ["b"] },
    ]);

    const result = detectExplorations(
      embeddings,
      emptyBacklinks,
      clusters,
      emptyRelations,
      { closeClusterThreshold: 0.85, metaNoteIds: new Set() },
    );

    const ids = result.suggestions.map((s) => s.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("all suggestions have a detectedAt timestamp", () => {
    const embeddings = makeEmbeddings(["a"]);

    const result = detectExplorations(
      embeddings,
      emptyBacklinks,
      emptyClusters,
      emptyRelations,
    );

    for (const s of result.suggestions) {
      expect(typeof s.detectedAt).toBe("string");
      expect(s.detectedAt).toBeTruthy();
    }
  });

  it("returns all four suggestion types in the same pass", () => {
    // orphan: note-z (no backlinks)
    const embeddings = makeEmbeddings(["a", "b", "z"]);
    const backlinks = makeBacklinks({ a: ["b"], b: ["a"] }); // z is orphan
    // close clusters
    const clusters = makeClusters([
      { id: "c1", centroid: [1, 0, 0], noteIds: ["a"] },
      { id: "c2", centroid: [0.999, 0.045, 0], noteIds: ["b"] },
    ]);
    // no external relations → structural holes for both clusters
    const relations = emptyRelations;
    // neither cluster has meta note
    const metaNoteIds = new Set<string>();

    const result = detectExplorations(
      embeddings,
      backlinks,
      clusters,
      relations,
      { closeClusterThreshold: 0.85, metaNoteIds },
    );

    const types = new Set(result.suggestions.map((s) => s.type));
    expect(types.has("orphan-note")).toBe(true);
    expect(types.has("close-clusters")).toBe(true);
    expect(types.has("structural-hole")).toBe(true);
    expect(types.has("meta-note-missing")).toBe(true);
  });
});
