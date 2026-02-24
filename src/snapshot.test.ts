import { describe, expect, it } from "vitest";
import { captureSnapshot } from "./snapshot";
import type {
  EmbeddingsIndex,
  BacklinksIndex,
  ClustersIndex,
  TensionsIndex,
  DecayIndex,
} from "@/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEmbeddings(noteIds: string[]): EmbeddingsIndex {
  const embeddings: EmbeddingsIndex["embeddings"] = {};
  for (const id of noteIds) {
    embeddings[id] = { noteId: id, vector: [1, 0], model: "test", createdAt: "t" };
  }
  return { embeddings };
}

function makeBacklinks(
  links: Record<string, string[]>,
): BacklinksIndex {
  const result: BacklinksIndex["links"] = {};
  for (const [noteId, targets] of Object.entries(links)) {
    result[noteId] = targets.map((targetId) => ({ targetId, similarity: 0.9 }));
  }
  return { links: result };
}

function makeClusters(
  entries: Record<string, string[]>,
): ClustersIndex {
  const clusters: ClustersIndex["clusters"] = {};
  for (const [id, noteIds] of Object.entries(entries)) {
    clusters[id] = {
      id,
      centroid: [1, 0],
      noteIds,
      createdAt: "t",
      updatedAt: "t",
    };
  }
  return { clusters, computedAt: "t" };
}

function makeTensions(ids: string[]): TensionsIndex {
  const tensions: TensionsIndex["tensions"] = {};
  for (const id of ids) {
    tensions[id] = {
      id,
      noteA: "note-a",
      noteB: "note-b",
      similarity: 0.3,
      clusterId: "cluster-0",
      detectedAt: "t",
    };
  }
  return { tensions, computedAt: "t" };
}

function makeDecay(noteIds: string[]): DecayIndex {
  const records: DecayIndex["records"] = {};
  for (const noteId of noteIds) {
    records[noteId] = {
      noteId,
      score: 0.4,
      reasons: ["no-links"],
      computedAt: "t",
    };
  }
  return { records, computedAt: "t" };
}

const emptyEmbeddings: EmbeddingsIndex = { embeddings: {} };
const emptyBacklinks: BacklinksIndex = { links: {} };
const emptyClusters: ClustersIndex = { clusters: {}, computedAt: "t" };
const emptyTensions: TensionsIndex = { tensions: {}, computedAt: "t" };
const emptyDecay: DecayIndex = { records: {}, computedAt: "t" };

// ---------------------------------------------------------------------------
// captureSnapshot
// ---------------------------------------------------------------------------

describe("captureSnapshot", () => {
  it("returns a snapshot with correct id prefix", () => {
    const snapshot = captureSnapshot(
      emptyEmbeddings,
      emptyBacklinks,
      emptyClusters,
      emptyTensions,
      emptyDecay,
    );

    expect(snapshot.id).toMatch(/^snapshot-\d+$/);
  });

  it("sets capturedAt to a valid ISO timestamp", () => {
    const before = new Date().toISOString();
    const snapshot = captureSnapshot(
      emptyEmbeddings,
      emptyBacklinks,
      emptyClusters,
      emptyTensions,
      emptyDecay,
    );
    const after = new Date().toISOString();

    expect(snapshot.capturedAt >= before).toBe(true);
    expect(snapshot.capturedAt <= after).toBe(true);
  });

  it("counts notes correctly", () => {
    const emb = makeEmbeddings(["note-a", "note-b", "note-c"]);
    const snapshot = captureSnapshot(
      emb,
      emptyBacklinks,
      emptyClusters,
      emptyTensions,
      emptyDecay,
    );

    expect(snapshot.noteCount).toBe(3);
  });

  it("returns noteCount 0 for empty embeddings", () => {
    const snapshot = captureSnapshot(
      emptyEmbeddings,
      emptyBacklinks,
      emptyClusters,
      emptyTensions,
      emptyDecay,
    );

    expect(snapshot.noteCount).toBe(0);
  });

  it("counts unique link pairs without double-counting bidirectional links", () => {
    // A↔B and A↔C: backlinks structure stores both directions
    const bl = makeBacklinks({
      "note-a": ["note-b", "note-c"],
      "note-b": ["note-a"],
      "note-c": ["note-a"],
    });
    const emb = makeEmbeddings(["note-a", "note-b", "note-c"]);
    const snapshot = captureSnapshot(
      emb,
      bl,
      emptyClusters,
      emptyTensions,
      emptyDecay,
    );

    // Unique pairs: (note-a, note-b) and (note-a, note-c) = 2
    expect(snapshot.linkCount).toBe(2);
  });

  it("returns linkCount 0 for empty backlinks", () => {
    const snapshot = captureSnapshot(
      emptyEmbeddings,
      emptyBacklinks,
      emptyClusters,
      emptyTensions,
      emptyDecay,
    );

    expect(snapshot.linkCount).toBe(0);
  });

  it("counts clusters correctly", () => {
    const cl = makeClusters({
      "cluster-0": ["note-a", "note-b"],
      "cluster-1": ["note-c"],
    });
    const snapshot = captureSnapshot(
      emptyEmbeddings,
      emptyBacklinks,
      cl,
      emptyTensions,
      emptyDecay,
    );

    expect(snapshot.clusterCount).toBe(2);
  });

  it("returns clusterCount 0 for empty clusters", () => {
    const snapshot = captureSnapshot(
      emptyEmbeddings,
      emptyBacklinks,
      emptyClusters,
      emptyTensions,
      emptyDecay,
    );

    expect(snapshot.clusterCount).toBe(0);
  });

  it("counts tensions correctly", () => {
    const ten = makeTensions(["tension-0", "tension-1", "tension-2"]);
    const snapshot = captureSnapshot(
      emptyEmbeddings,
      emptyBacklinks,
      emptyClusters,
      ten,
      emptyDecay,
    );

    expect(snapshot.tensionCount).toBe(3);
  });

  it("returns tensionCount 0 for empty tensions", () => {
    const snapshot = captureSnapshot(
      emptyEmbeddings,
      emptyBacklinks,
      emptyClusters,
      emptyTensions,
      emptyDecay,
    );

    expect(snapshot.tensionCount).toBe(0);
  });

  it("counts decay records correctly", () => {
    const dec = makeDecay(["note-a", "note-b"]);
    const snapshot = captureSnapshot(
      emptyEmbeddings,
      emptyBacklinks,
      emptyClusters,
      emptyTensions,
      dec,
    );

    expect(snapshot.decayCount).toBe(2);
  });

  it("returns decayCount 0 for empty decay index", () => {
    const snapshot = captureSnapshot(
      emptyEmbeddings,
      emptyBacklinks,
      emptyClusters,
      emptyTensions,
      emptyDecay,
    );

    expect(snapshot.decayCount).toBe(0);
  });

  it("computes clusterSizes correctly", () => {
    const cl = makeClusters({
      "cluster-0": ["note-a", "note-b", "note-c"],
      "cluster-1": ["note-d"],
    });
    const snapshot = captureSnapshot(
      emptyEmbeddings,
      emptyBacklinks,
      cl,
      emptyTensions,
      emptyDecay,
    );

    expect(snapshot.clusterSizes["cluster-0"]).toBe(3);
    expect(snapshot.clusterSizes["cluster-1"]).toBe(1);
  });

  it("returns empty clusterSizes for empty clusters", () => {
    const snapshot = captureSnapshot(
      emptyEmbeddings,
      emptyBacklinks,
      emptyClusters,
      emptyTensions,
      emptyDecay,
    );

    expect(snapshot.clusterSizes).toEqual({});
  });

  it("computes avgLinksPerNote as total directed links / noteCount", () => {
    // note-a → [note-b, note-c], note-b → [note-a], note-c → [note-a]
    // total directed links = 2 + 1 + 1 = 4, noteCount = 3
    const emb = makeEmbeddings(["note-a", "note-b", "note-c"]);
    const bl = makeBacklinks({
      "note-a": ["note-b", "note-c"],
      "note-b": ["note-a"],
      "note-c": ["note-a"],
    });
    const snapshot = captureSnapshot(
      emb,
      bl,
      emptyClusters,
      emptyTensions,
      emptyDecay,
    );

    expect(snapshot.avgLinksPerNote).toBeCloseTo(4 / 3, 5);
  });

  it("returns avgLinksPerNote 0 when noteCount is 0", () => {
    const snapshot = captureSnapshot(
      emptyEmbeddings,
      emptyBacklinks,
      emptyClusters,
      emptyTensions,
      emptyDecay,
    );

    expect(snapshot.avgLinksPerNote).toBe(0);
  });

  it("captures all fields in a typical scenario", () => {
    const emb = makeEmbeddings(["note-a", "note-b"]);
    const bl = makeBacklinks({
      "note-a": ["note-b"],
      "note-b": ["note-a"],
    });
    const cl = makeClusters({ "cluster-0": ["note-a", "note-b"] });
    const ten = makeTensions(["tension-0"]);
    const dec = makeDecay(["note-a"]);

    const snapshot = captureSnapshot(emb, bl, cl, ten, dec);

    expect(snapshot.noteCount).toBe(2);
    expect(snapshot.linkCount).toBe(1);
    expect(snapshot.clusterCount).toBe(1);
    expect(snapshot.tensionCount).toBe(1);
    expect(snapshot.decayCount).toBe(1);
    expect(snapshot.clusterSizes["cluster-0"]).toBe(2);
    expect(snapshot.avgLinksPerNote).toBe(1); // 2 directed / 2 notes
  });
});
