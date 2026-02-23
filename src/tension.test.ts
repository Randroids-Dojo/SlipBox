import { describe, expect, it } from "vitest";
import { detectTensions } from "./tension";
import type { EmbeddingsIndex, ClustersIndex } from "@/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal embeddings index from note-id → vector pairs. */
function makeEmbeddings(
  entries: Record<string, number[]>,
): EmbeddingsIndex {
  const embeddings: EmbeddingsIndex["embeddings"] = {};
  for (const [id, vector] of Object.entries(entries)) {
    embeddings[id] = { noteId: id, vector, model: "test", createdAt: "t" };
  }
  return { embeddings };
}

/** Build a minimal clusters index from cluster-id → noteIds pairs. */
function makeClusters(
  entries: Record<string, string[]>,
): ClustersIndex {
  const clusters: ClustersIndex["clusters"] = {};
  for (const [id, noteIds] of Object.entries(entries)) {
    clusters[id] = {
      id,
      centroid: [],
      noteIds: noteIds.sort(),
      createdAt: "t",
      updatedAt: "t",
    };
  }
  return { clusters, computedAt: "t" };
}

// ---------------------------------------------------------------------------
// detectTensions
// ---------------------------------------------------------------------------

describe("detectTensions", () => {
  it("returns empty index when clusters are empty", () => {
    const emb = makeEmbeddings({ "note-a": [1, 0], "note-b": [0, 1] });
    const clusters = makeClusters({});

    const result = detectTensions(emb, clusters);

    expect(Object.keys(result.tensions)).toHaveLength(0);
    expect(result.computedAt).toBeTruthy();
  });

  it("returns empty index when clusters have only one note each", () => {
    const emb = makeEmbeddings({
      "note-a": [1, 0],
      "note-b": [0, 1],
    });
    const clusters = makeClusters({
      "cluster-0": ["note-a"],
      "cluster-1": ["note-b"],
    });

    const result = detectTensions(emb, clusters);

    expect(Object.keys(result.tensions)).toHaveLength(0);
  });

  it("detects tension between orthogonal vectors in same cluster", () => {
    // cosine similarity of [1,0] and [0,1] is 0.0 — well below any threshold
    const emb = makeEmbeddings({
      "note-a": [1, 0],
      "note-b": [0, 1],
    });
    const clusters = makeClusters({
      "cluster-0": ["note-a", "note-b"],
    });

    const result = detectTensions(emb, clusters, 0.5);

    expect(Object.keys(result.tensions)).toHaveLength(1);

    const tension = Object.values(result.tensions)[0];
    expect(tension.noteA).toBe("note-a");
    expect(tension.noteB).toBe("note-b");
    expect(tension.similarity).toBeCloseTo(0, 5);
    expect(tension.clusterId).toBe("cluster-0");
  });

  it("does not flag aligned vectors as tension", () => {
    // cosine similarity of [1,0,0] and [1,0.01,0] is ~0.99995 — very aligned
    const emb = makeEmbeddings({
      "note-a": [1, 0, 0],
      "note-b": [1, 0.01, 0],
    });
    const clusters = makeClusters({
      "cluster-0": ["note-a", "note-b"],
    });

    const result = detectTensions(emb, clusters, 0.72);

    expect(Object.keys(result.tensions)).toHaveLength(0);
  });

  it("respects custom threshold", () => {
    // cosine similarity of [1,0] and [0.7,0.7] is ~0.707
    const emb = makeEmbeddings({
      "note-a": [1, 0],
      "note-b": [0.7, 0.7],
    });
    const clusters = makeClusters({
      "cluster-0": ["note-a", "note-b"],
    });

    // threshold = 0.8 → sim 0.707 < 0.8 → tension
    const high = detectTensions(emb, clusters, 0.8);
    expect(Object.keys(high.tensions)).toHaveLength(1);

    // threshold = 0.5 → sim 0.707 > 0.5 → no tension
    const low = detectTensions(emb, clusters, 0.5);
    expect(Object.keys(low.tensions)).toHaveLength(0);
  });

  it("detects multiple tensions in one cluster", () => {
    // Three notes: A & B aligned, A & C divergent, B & C divergent
    const emb = makeEmbeddings({
      "note-a": [1, 0, 0],
      "note-b": [0.98, 0.2, 0],
      "note-c": [0, 0, 1],
    });
    const clusters = makeClusters({
      "cluster-0": ["note-a", "note-b", "note-c"],
    });

    const result = detectTensions(emb, clusters, 0.5);

    // A-C and B-C should be tensions (orthogonal), A-B should not (very similar)
    const tensions = Object.values(result.tensions);
    expect(tensions.length).toBe(2);

    const pairs = tensions.map((t) => `${t.noteA}:${t.noteB}`).sort();
    expect(pairs).toContain("note-a:note-c");
    expect(pairs).toContain("note-b:note-c");
  });

  it("detects tensions across multiple clusters", () => {
    const emb = makeEmbeddings({
      "note-a": [1, 0],
      "note-b": [0, 1],
      "note-c": [1, 0],
      "note-d": [-1, 0],
    });
    const clusters = makeClusters({
      "cluster-0": ["note-a", "note-b"],
      "cluster-1": ["note-c", "note-d"],
    });

    const result = detectTensions(emb, clusters, 0.5);

    const tensions = Object.values(result.tensions);
    expect(tensions.length).toBe(2);

    // One tension in each cluster
    const clusterIds = tensions.map((t) => t.clusterId).sort();
    expect(clusterIds).toEqual(["cluster-0", "cluster-1"]);
  });

  it("uses canonical note ordering (smaller ID first)", () => {
    const emb = makeEmbeddings({
      "note-z": [1, 0],
      "note-a": [0, 1],
    });
    const clusters = makeClusters({
      "cluster-0": ["note-a", "note-z"],
    });

    const result = detectTensions(emb, clusters, 0.5);
    const tension = Object.values(result.tensions)[0];

    expect(tension.noteA).toBe("note-a");
    expect(tension.noteB).toBe("note-z");
  });

  it("assigns sequential tension IDs", () => {
    const emb = makeEmbeddings({
      "note-a": [1, 0, 0],
      "note-b": [0, 1, 0],
      "note-c": [0, 0, 1],
    });
    const clusters = makeClusters({
      "cluster-0": ["note-a", "note-b", "note-c"],
    });

    const result = detectTensions(emb, clusters, 0.5);
    const ids = Object.keys(result.tensions).sort();

    expect(ids).toEqual(["tension-0", "tension-1", "tension-2"]);
  });

  it("sets timestamps on tension records", () => {
    const emb = makeEmbeddings({
      "note-a": [1, 0],
      "note-b": [0, 1],
    });
    const clusters = makeClusters({
      "cluster-0": ["note-a", "note-b"],
    });

    const result = detectTensions(emb, clusters, 0.5);

    expect(result.computedAt).toBeTruthy();
    for (const tension of Object.values(result.tensions)) {
      expect(tension.detectedAt).toBeTruthy();
      expect(tension.detectedAt).toBe(result.computedAt);
    }
  });

  it("skips notes with missing embeddings gracefully", () => {
    const emb = makeEmbeddings({
      "note-a": [1, 0],
      // "note-b" is in the cluster but has no embedding
    });
    const clusters = makeClusters({
      "cluster-0": ["note-a", "note-b"],
    });

    // Should not throw, just skip the pair
    const result = detectTensions(emb, clusters, 0.5);
    expect(Object.keys(result.tensions)).toHaveLength(0);
  });

  it("returns correct similarity scores", () => {
    // Known cosine similarity: [1,1] · [1,-1] = 0, magnitudes = √2 each
    // cos = 0 / 2 = 0
    const emb = makeEmbeddings({
      "note-a": [1, 1],
      "note-b": [1, -1],
    });
    const clusters = makeClusters({
      "cluster-0": ["note-a", "note-b"],
    });

    const result = detectTensions(emb, clusters, 0.5);
    const tension = Object.values(result.tensions)[0];

    expect(tension.similarity).toBeCloseTo(0, 5);
  });

  it("returns empty for clusters where all pairs are aligned", () => {
    const emb = makeEmbeddings({
      "note-a": [1, 0, 0],
      "note-b": [0.99, 0.14, 0],
      "note-c": [0.98, 0.2, 0],
    });
    const clusters = makeClusters({
      "cluster-0": ["note-a", "note-b", "note-c"],
    });

    // All pairs have similarity > 0.95, threshold at 0.72 → no tensions
    const result = detectTensions(emb, clusters, 0.72);

    expect(Object.keys(result.tensions)).toHaveLength(0);
  });
});
