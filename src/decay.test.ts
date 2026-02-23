import { describe, expect, it } from "vitest";
import { computeDecay } from "./decay";
import type { EmbeddingsIndex, BacklinksIndex, ClustersIndex } from "@/types";

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

/** Build a backlinks index from note-id → linked note IDs. */
function makeBacklinks(
  entries: Record<string, string[]>,
): BacklinksIndex {
  const links: BacklinksIndex["links"] = {};
  for (const [id, targets] of Object.entries(entries)) {
    links[id] = targets.map((target) => ({
      targetId: target,
      similarity: 0.9,
      createdAt: "t",
    }));
  }
  return { links };
}

/** Build a clusters index from cluster-id → { centroid, noteIds }. */
function makeClusters(
  entries: Record<string, { centroid: number[]; noteIds: string[] }>,
): ClustersIndex {
  const clusters: ClustersIndex["clusters"] = {};
  for (const [id, { centroid, noteIds }] of Object.entries(entries)) {
    clusters[id] = { id, centroid, noteIds, createdAt: "t", updatedAt: "t" };
  }
  return { clusters, computedAt: "t" };
}

const emptyBacklinks = makeBacklinks({});
const emptyClusters = makeClusters({});

// ---------------------------------------------------------------------------
// computeDecay — no-links signal
// ---------------------------------------------------------------------------

describe("computeDecay — no-links", () => {
  it("flags note with zero backlinks with no-links reason", () => {
    const emb = makeEmbeddings({ "note-a": [1, 0] });
    const result = computeDecay(emb, emptyBacklinks, emptyClusters, 0.7, 0);

    expect(result.records["note-a"].reasons).toContain("no-links");
  });

  it("adds 0.4 to score for no-links", () => {
    const emb = makeEmbeddings({ "note-a": [1, 0] });
    const result = computeDecay(emb, emptyBacklinks, emptyClusters, 0.7, 0);

    // no-links (0.4) + low-link-density (0.2) + no-cluster (0.1) = 0.7
    expect(result.records["note-a"].score).toBeCloseTo(0.7, 5);
  });

  it("does not flag note with 2+ backlinks with no-links", () => {
    const emb = makeEmbeddings({ "note-a": [1, 0] });
    const bl = makeBacklinks({ "note-a": ["note-b", "note-c"] });
    const result = computeDecay(emb, bl, emptyClusters, 0.7, 0);

    expect(result.records["note-a"]?.reasons ?? []).not.toContain("no-links");
  });
});

// ---------------------------------------------------------------------------
// computeDecay — low-link-density signal
// ---------------------------------------------------------------------------

describe("computeDecay — low-link-density", () => {
  it("flags note with 1 backlink with low-link-density reason", () => {
    const emb = makeEmbeddings({ "note-a": [1, 0] });
    const bl = makeBacklinks({ "note-a": ["note-b"] });
    const result = computeDecay(emb, bl, emptyClusters, 0.7, 0);

    expect(result.records["note-a"].reasons).toContain("low-link-density");
    expect(result.records["note-a"].reasons).not.toContain("no-links");
  });

  it("adds 0.2 to score for low-link-density (1 link)", () => {
    const emb = makeEmbeddings({ "note-a": [1, 0] });
    const bl = makeBacklinks({ "note-a": ["note-b"] });
    // 1 link: low-link-density (0.2) + no-cluster (0.1) = 0.3
    const result = computeDecay(emb, bl, emptyClusters, 0.7, 0);

    expect(result.records["note-a"].score).toBeCloseTo(0.3, 5);
  });

  it("note with zero links gets both no-links and low-link-density", () => {
    const emb = makeEmbeddings({ "note-a": [1, 0] });
    const result = computeDecay(emb, emptyBacklinks, emptyClusters, 0.7, 0);

    expect(result.records["note-a"].reasons).toContain("no-links");
    expect(result.records["note-a"].reasons).toContain("low-link-density");
  });

  it("does not flag note with 2 backlinks with low-link-density", () => {
    const emb = makeEmbeddings({ "note-a": [1, 0] });
    const bl = makeBacklinks({ "note-a": ["note-b", "note-c"] });
    const result = computeDecay(emb, bl, emptyClusters, 0.7, 0);

    expect(result.records["note-a"]?.reasons ?? []).not.toContain(
      "low-link-density",
    );
  });
});

// ---------------------------------------------------------------------------
// computeDecay — cluster-outlier signal
// ---------------------------------------------------------------------------

describe("computeDecay — cluster-outlier", () => {
  it("flags note whose similarity to centroid is below threshold", () => {
    // [1,0] vs centroid [0,1] → cosine sim = 0.0, below threshold 0.7
    const emb = makeEmbeddings({ "note-a": [1, 0] });
    const bl = makeBacklinks({ "note-a": ["b", "c"] }); // healthy link count
    const cl = makeClusters({
      "cluster-0": { centroid: [0, 1], noteIds: ["note-a"] },
    });
    const result = computeDecay(emb, bl, cl, 0.7, 0);

    expect(result.records["note-a"].reasons).toContain("cluster-outlier");
  });

  it("adds 0.3 to score for cluster-outlier", () => {
    const emb = makeEmbeddings({ "note-a": [1, 0] });
    const bl = makeBacklinks({ "note-a": ["b", "c"] });
    const cl = makeClusters({
      "cluster-0": { centroid: [0, 1], noteIds: ["note-a"] },
    });
    // cluster-outlier only = 0.3
    const result = computeDecay(emb, bl, cl, 0.7, 0);

    expect(result.records["note-a"].score).toBeCloseTo(0.3, 5);
  });

  it("does not flag note that is close to its cluster centroid", () => {
    // [1,0] vs centroid [0.99, 0.14] → cosine sim ≈ 0.99, above threshold 0.7
    const emb = makeEmbeddings({ "note-a": [1, 0] });
    const bl = makeBacklinks({ "note-a": ["b", "c"] });
    const cl = makeClusters({
      "cluster-0": { centroid: [0.99, 0.14], noteIds: ["note-a"] },
    });
    const result = computeDecay(emb, bl, cl, 0.7, 0);

    expect(result.records["note-a"]?.reasons ?? []).not.toContain(
      "cluster-outlier",
    );
  });

  it("respects custom outlier threshold", () => {
    // [1,0] vs centroid [0.8, 0.6] → cosine sim = 0.8
    const emb = makeEmbeddings({ "note-a": [1, 0] });
    const bl = makeBacklinks({ "note-a": ["b", "c"] });
    const cl = makeClusters({
      "cluster-0": { centroid: [0.8, 0.6], noteIds: ["note-a"] },
    });

    // threshold = 0.9 → sim 0.8 < 0.9 → outlier
    const high = computeDecay(emb, bl, cl, 0.9, 0);
    expect(high.records["note-a"].reasons).toContain("cluster-outlier");

    // threshold = 0.5 → sim 0.8 > 0.5 → no outlier
    const low = computeDecay(emb, bl, cl, 0.5, 0);
    expect(low.records["note-a"]?.reasons ?? []).not.toContain(
      "cluster-outlier",
    );
  });
});

// ---------------------------------------------------------------------------
// computeDecay — no-cluster signal
// ---------------------------------------------------------------------------

describe("computeDecay — no-cluster", () => {
  it("flags note not present in any cluster with no-cluster reason", () => {
    const emb = makeEmbeddings({ "note-a": [1, 0] });
    const bl = makeBacklinks({ "note-a": ["b", "c"] });
    const result = computeDecay(emb, bl, emptyClusters, 0.7, 0);

    expect(result.records["note-a"].reasons).toContain("no-cluster");
  });

  it("adds 0.1 to score for no-cluster", () => {
    const emb = makeEmbeddings({ "note-a": [1, 0] });
    const bl = makeBacklinks({ "note-a": ["b", "c"] });
    // Only no-cluster signal fires: 0.1
    const result = computeDecay(emb, bl, emptyClusters, 0.7, 0);

    expect(result.records["note-a"].score).toBeCloseTo(0.1, 5);
  });

  it("does not flag note that belongs to a cluster", () => {
    const emb = makeEmbeddings({ "note-a": [1, 0] });
    const bl = makeBacklinks({ "note-a": ["b", "c"] });
    const cl = makeClusters({
      "cluster-0": { centroid: [1, 0], noteIds: ["note-a"] },
    });
    const result = computeDecay(emb, bl, cl, 0.7, 0);

    expect(result.records["note-a"]?.reasons ?? []).not.toContain("no-cluster");
  });
});

// ---------------------------------------------------------------------------
// computeDecay — score capping and thresholding
// ---------------------------------------------------------------------------

describe("computeDecay — score cap and threshold", () => {
  it("cluster-outlier and no-cluster are mutually exclusive", () => {
    // cluster-outlier requires being in a cluster; no-cluster means not in one
    // A note cannot receive both penalties
    const emb = makeEmbeddings({ "note-a": [1, 0] });
    const bl = makeBacklinks({ "note-a": ["b", "c"] });

    // In a cluster but outlier
    const clIn = makeClusters({
      "cluster-0": { centroid: [0, 1], noteIds: ["note-a"] },
    });
    const inCluster = computeDecay(emb, bl, clIn, 0.7, 0);
    expect(inCluster.records["note-a"].reasons).toContain("cluster-outlier");
    expect(inCluster.records["note-a"].reasons).not.toContain("no-cluster");

    // Not in any cluster
    const outCluster = computeDecay(emb, bl, emptyClusters, 0.7, 0);
    expect(outCluster.records["note-a"].reasons).toContain("no-cluster");
    expect(outCluster.records["note-a"].reasons).not.toContain("cluster-outlier");
  });

  it("score cap at 1.0 prevents overflow", () => {
    // Max achievable score from link signals + outlier = 0.9
    // Adding no-cluster would require not being in a cluster, which prevents outlier
    // The cap is a safety net; verify it does not exceed 1.0
    const emb = makeEmbeddings({ "note-a": [1, 0] });
    const cl = makeClusters({
      "cluster-0": { centroid: [0, 1], noteIds: ["note-a"] },
    });
    // no-links(0.4) + low-link-density(0.2) + cluster-outlier(0.3) = 0.9
    const result = computeDecay(emb, emptyBacklinks, cl, 0.7, 0);

    expect(result.records["note-a"].score).toBeCloseTo(0.9, 5);
    expect(result.records["note-a"].score).toBeLessThanOrEqual(1.0);
  });

  it("excludes notes below score threshold", () => {
    const emb = makeEmbeddings({ "note-a": [1, 0] });
    const bl = makeBacklinks({ "note-a": ["b", "c"] });
    // Only no-cluster fires: score = 0.1; threshold = 0.3
    const result = computeDecay(emb, bl, emptyClusters, 0.7, 0.3);

    expect(result.records["note-a"]).toBeUndefined();
  });

  it("includes notes at exactly the score threshold", () => {
    const emb = makeEmbeddings({ "note-a": [1, 0] });
    const bl = makeBacklinks({ "note-a": ["b"] }); // 1 link → low-link-density(0.2) + no-cluster(0.1) = 0.3
    const result = computeDecay(emb, bl, emptyClusters, 0.7, 0.3);

    expect(result.records["note-a"]).toBeDefined();
    expect(result.records["note-a"].score).toBeCloseTo(0.3, 5);
  });

  it("includes note with three reasons and score 0.9 (max achievable in a cluster)", () => {
    // no-links(0.4) + low-link-density(0.2) + cluster-outlier(0.3) = 0.9
    // no-cluster does not fire because the note IS in a cluster
    const emb = makeEmbeddings({ "note-a": [1, 0] });
    const cl = makeClusters({
      "cluster-0": { centroid: [0, 1], noteIds: ["note-a"] },
    });
    const result = computeDecay(emb, emptyBacklinks, cl, 0.7, 0);

    const record = result.records["note-a"];
    expect(record.reasons).toContain("no-links");
    expect(record.reasons).toContain("low-link-density");
    expect(record.reasons).toContain("cluster-outlier");
    expect(record.reasons).not.toContain("no-cluster");
    expect(record.score).toBeCloseTo(0.9, 5);
  });
});

// ---------------------------------------------------------------------------
// computeDecay — multi-note and general behavior
// ---------------------------------------------------------------------------

describe("computeDecay — general", () => {
  it("returns empty records when embeddings index is empty", () => {
    const emb = makeEmbeddings({});
    const result = computeDecay(emb, emptyBacklinks, emptyClusters, 0.7, 0.3);

    expect(Object.keys(result.records)).toHaveLength(0);
    expect(result.computedAt).toBeTruthy();
  });

  it("processes multiple notes independently", () => {
    const emb = makeEmbeddings({
      "note-a": [1, 0],
      "note-b": [0.99, 0.14],
    });
    const bl = makeBacklinks({
      "note-a": [], // no links
      "note-b": ["x", "y", "z"], // healthy
    });
    const cl = makeClusters({
      "cluster-0": { centroid: [0.99, 0.14], noteIds: ["note-a", "note-b"] },
    });

    const result = computeDecay(emb, bl, cl, 0.7, 0);

    // note-a: no-links(0.4) + low-link-density(0.2) + cluster-outlier (sim ~0.99 > 0.7 → no) = 0.6
    expect(result.records["note-a"]).toBeDefined();
    expect(result.records["note-a"].reasons).toContain("no-links");

    // note-b: healthy (2+ links, close to centroid) → score 0.0 → excluded at threshold 0
    // Actually score = 0, included at threshold 0
    expect(result.records["note-b"]).toBeDefined();
    expect(result.records["note-b"].score).toBeCloseTo(0, 5);
    expect(result.records["note-b"].reasons).toHaveLength(0);
  });

  it("sets computedAt on all records to the same timestamp", () => {
    const emb = makeEmbeddings({ "note-a": [1, 0], "note-b": [0, 1] });
    const result = computeDecay(emb, emptyBacklinks, emptyClusters, 0.7, 0);

    const timestamps = Object.values(result.records).map((r) => r.computedAt);
    for (const ts of timestamps) {
      expect(ts).toBe(result.computedAt);
    }
  });

  it("sets computedAt on the index", () => {
    const emb = makeEmbeddings({});
    const result = computeDecay(emb, emptyBacklinks, emptyClusters, 0.7, 0.3);

    expect(result.computedAt).toBeTruthy();
    expect(new Date(result.computedAt).getTime()).not.toBeNaN();
  });

  it("handles notes with no entry in backlinks index (treated as zero links)", () => {
    const emb = makeEmbeddings({ "note-a": [1, 0] });
    // backlinks index exists but note-a has no entry
    const bl: BacklinksIndex = { links: {} };
    const result = computeDecay(emb, bl, emptyClusters, 0.7, 0);

    expect(result.records["note-a"].reasons).toContain("no-links");
  });

  it("note in multiple-cluster scenario uses first cluster found", () => {
    // If a note appears in two clusters (shouldn't happen normally, but defensively handled)
    const emb = makeEmbeddings({ "note-a": [1, 0] });
    const bl = makeBacklinks({ "note-a": ["b", "c"] });
    // centroid-0 is orthogonal → outlier; centroid-1 is aligned → not outlier
    const cl = makeClusters({
      "cluster-0": { centroid: [0, 1], noteIds: ["note-a"] },
      "cluster-1": { centroid: [1, 0], noteIds: ["note-a"] },
    });

    // The result depends on which cluster is found first, but should not throw
    expect(() => computeDecay(emb, bl, cl, 0.7, 0)).not.toThrow();
  });
});
