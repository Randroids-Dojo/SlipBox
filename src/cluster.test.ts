import { describe, expect, it } from "vitest";
import {
  chooseK,
  squaredDistance,
  kmeansppInit,
  kmeans,
  clusterEmbeddings,
} from "./cluster";
import type { EmbeddingsIndex } from "@/types";

// ---------------------------------------------------------------------------
// chooseK
// ---------------------------------------------------------------------------

describe("chooseK", () => {
  it("returns 0 when n is less than min", () => {
    expect(chooseK(1, 2, 20)).toBe(0);
    expect(chooseK(0, 2, 20)).toBe(0);
  });

  it("returns min when sqrt heuristic is below min", () => {
    // n=3, sqrt(3/2) = ~1.22, floor = 1, clamped to min=2
    expect(chooseK(3, 2, 20)).toBe(2);
  });

  it("applies sqrt(n/2) heuristic for moderate n", () => {
    // n=50, sqrt(50/2) = sqrt(25) = 5
    expect(chooseK(50, 2, 20)).toBe(5);
  });

  it("caps at max for large n", () => {
    // n=10000, sqrt(10000/2) = sqrt(5000) = ~70, clamped to max=20
    expect(chooseK(10000, 2, 20)).toBe(20);
  });

  it("returns exact value for known inputs", () => {
    // n=8, sqrt(8/2) = sqrt(4) = 2
    expect(chooseK(8, 2, 20)).toBe(2);
    // n=18, sqrt(18/2) = sqrt(9) = 3
    expect(chooseK(18, 2, 20)).toBe(3);
    // n=32, sqrt(32/2) = sqrt(16) = 4
    expect(chooseK(32, 2, 20)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// squaredDistance
// ---------------------------------------------------------------------------

describe("squaredDistance", () => {
  it("returns 0 for identical vectors", () => {
    expect(squaredDistance([1, 2, 3], [1, 2, 3])).toBe(0);
  });

  it("computes correct distance for known vectors", () => {
    // (1-4)^2 + (0-0)^2 + (0-0)^2 = 9
    expect(squaredDistance([1, 0, 0], [4, 0, 0])).toBe(9);
  });

  it("computes distance for multi-dimensional vectors", () => {
    // (1-2)^2 + (3-4)^2 + (5-6)^2 = 1+1+1 = 3
    expect(squaredDistance([1, 3, 5], [2, 4, 6])).toBe(3);
  });

  it("is symmetric", () => {
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    expect(squaredDistance(a, b)).toBe(squaredDistance(b, a));
  });
});

// ---------------------------------------------------------------------------
// kmeansppInit
// ---------------------------------------------------------------------------

describe("kmeansppInit", () => {
  it("returns k centroids", () => {
    const vectors = [
      [0, 0],
      [1, 0],
      [0, 1],
      [10, 10],
      [11, 10],
    ];
    const centroids = kmeansppInit(vectors, 2, () => 0.5);
    expect(centroids).toHaveLength(2);
  });

  it("centroids have correct dimensionality", () => {
    const vectors = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ];
    const centroids = kmeansppInit(vectors, 2, () => 0.1);
    for (const c of centroids) {
      expect(c).toHaveLength(3);
    }
  });

  it("does not return references to original vectors", () => {
    const vectors = [[1, 2], [3, 4]];
    const centroids = kmeansppInit(vectors, 2, () => 0.5);
    // Modifying centroid should not affect original
    centroids[0][0] = 999;
    expect(vectors[0][0]).not.toBe(999);
    expect(vectors[1][0]).not.toBe(999);
  });
});

// ---------------------------------------------------------------------------
// kmeans
// ---------------------------------------------------------------------------

describe("kmeans", () => {
  it("assigns identical vectors to the same cluster", () => {
    const vectors = [
      [1, 0],
      [1, 0],
      [1, 0],
      [0, 1],
      [0, 1],
    ];
    const result = kmeans(vectors, 2, 50, [
      [1, 0],
      [0, 1],
    ]);

    // First three should share a cluster, last two share another
    expect(result.assignments[0]).toBe(result.assignments[1]);
    expect(result.assignments[0]).toBe(result.assignments[2]);
    expect(result.assignments[3]).toBe(result.assignments[4]);
    expect(result.assignments[0]).not.toBe(result.assignments[3]);
  });

  it("separates well-separated clusters", () => {
    const vectors = [
      [0, 0],
      [1, 0],
      [0, 1],
      [100, 100],
      [101, 100],
      [100, 101],
    ];

    const result = kmeans(vectors, 2, 50, [
      [0, 0],
      [100, 100],
    ]);

    // First 3 in one cluster, last 3 in another
    const clusterA = result.assignments[0];
    const clusterB = result.assignments[3];
    expect(clusterA).not.toBe(clusterB);

    expect(result.assignments[1]).toBe(clusterA);
    expect(result.assignments[2]).toBe(clusterA);
    expect(result.assignments[4]).toBe(clusterB);
    expect(result.assignments[5]).toBe(clusterB);
  });

  it("converges within max iterations", () => {
    const vectors = [
      [0, 0],
      [1, 0],
      [10, 10],
      [11, 10],
    ];
    const result = kmeans(vectors, 2, 100, [
      [0, 0],
      [10, 10],
    ]);
    expect(result.iterations).toBeLessThanOrEqual(100);
  });

  it("returns correct number of centroids", () => {
    const vectors = [
      [0, 0],
      [1, 0],
      [0, 1],
      [10, 10],
    ];
    const result = kmeans(vectors, 3, 50, [
      [0, 0],
      [1, 0],
      [10, 10],
    ]);
    expect(result.centroids).toHaveLength(3);
  });

  it("handles single-point clusters", () => {
    const vectors = [
      [0, 0],
      [100, 100],
    ];
    const result = kmeans(vectors, 2, 50, [
      [0, 0],
      [100, 100],
    ]);
    expect(result.assignments[0]).not.toBe(result.assignments[1]);
  });
});

// ---------------------------------------------------------------------------
// clusterEmbeddings
// ---------------------------------------------------------------------------

describe("clusterEmbeddings", () => {
  it("returns empty index for no notes", () => {
    const index: EmbeddingsIndex = { embeddings: {} };
    const result = clusterEmbeddings(index);
    expect(Object.keys(result.clusters)).toHaveLength(0);
    expect(result.computedAt).toBeTruthy();
  });

  it("returns empty index when notes are below minimum", () => {
    const index: EmbeddingsIndex = {
      embeddings: {
        "note-a": {
          noteId: "note-a",
          vector: [1, 0],
          model: "test",
          createdAt: "t",
        },
      },
    };
    // With default min=2, 1 note should return empty
    const result = clusterEmbeddings(index);
    expect(Object.keys(result.clusters)).toHaveLength(0);
  });

  it("clusters notes with explicit k", () => {
    const index: EmbeddingsIndex = {
      embeddings: {
        "note-a": {
          noteId: "note-a",
          vector: [0, 0, 0],
          model: "test",
          createdAt: "t",
        },
        "note-b": {
          noteId: "note-b",
          vector: [1, 0, 0],
          model: "test",
          createdAt: "t",
        },
        "note-c": {
          noteId: "note-c",
          vector: [100, 100, 100],
          model: "test",
          createdAt: "t",
        },
        "note-d": {
          noteId: "note-d",
          vector: [101, 100, 100],
          model: "test",
          createdAt: "t",
        },
      },
    };

    const result = clusterEmbeddings(index, { k: 2 });
    const clusters = Object.values(result.clusters);

    expect(clusters.length).toBe(2);

    // All notes should be assigned
    const allNoteIds = clusters.flatMap((c) => c.noteIds).sort();
    expect(allNoteIds).toEqual(["note-a", "note-b", "note-c", "note-d"]);

    // Close notes should be in the same cluster
    const clusterOfA = clusters.find((c) => c.noteIds.includes("note-a"))!;
    const clusterOfC = clusters.find((c) => c.noteIds.includes("note-c"))!;
    expect(clusterOfA.noteIds).toContain("note-b");
    expect(clusterOfC.noteIds).toContain("note-d");
    expect(clusterOfA.id).not.toBe(clusterOfC.id);
  });

  it("sets timestamps on cluster records", () => {
    const index: EmbeddingsIndex = {
      embeddings: {
        "note-a": {
          noteId: "note-a",
          vector: [0, 0],
          model: "test",
          createdAt: "t",
        },
        "note-b": {
          noteId: "note-b",
          vector: [1, 0],
          model: "test",
          createdAt: "t",
        },
        "note-c": {
          noteId: "note-c",
          vector: [0, 1],
          model: "test",
          createdAt: "t",
        },
      },
    };

    const result = clusterEmbeddings(index, { k: 2 });

    expect(result.computedAt).toBeTruthy();
    for (const cluster of Object.values(result.clusters)) {
      expect(cluster.createdAt).toBeTruthy();
      expect(cluster.updatedAt).toBeTruthy();
      expect(cluster.centroid).toBeDefined();
      expect(cluster.noteIds.length).toBeGreaterThan(0);
    }
  });

  it("cluster noteIds are sorted", () => {
    const index: EmbeddingsIndex = {
      embeddings: {
        "note-c": {
          noteId: "note-c",
          vector: [0, 0],
          model: "test",
          createdAt: "t",
        },
        "note-a": {
          noteId: "note-a",
          vector: [0, 0],
          model: "test",
          createdAt: "t",
        },
        "note-b": {
          noteId: "note-b",
          vector: [0, 0],
          model: "test",
          createdAt: "t",
        },
      },
    };

    const result = clusterEmbeddings(index, { k: 2 });

    for (const cluster of Object.values(result.clusters)) {
      const sorted = [...cluster.noteIds].sort();
      expect(cluster.noteIds).toEqual(sorted);
    }
  });
});
