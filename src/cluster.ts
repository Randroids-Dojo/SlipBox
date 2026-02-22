/**
 * Clustering module — k-means clustering of embedding vectors.
 *
 * Pure math, no external dependencies. Partitions notes into semantic
 * clusters by running k-means on their embedding vectors. The number
 * of clusters is selected automatically using a heuristic based on
 * the number of notes, bounded by configurable min/max limits.
 */

import type { EmbeddingVector, EmbeddingsIndex, NoteId } from "@/types";
import type { Cluster, ClustersIndex } from "@/types";
import {
  MIN_CLUSTERS,
  MAX_CLUSTERS,
  KMEANS_MAX_ITERATIONS,
} from "./config";

// ---------------------------------------------------------------------------
// K Selection
// ---------------------------------------------------------------------------

/**
 * Choose the number of clusters given the number of notes.
 *
 * Uses floor(sqrt(n / 2)) as a heuristic, clamped between the configured
 * min and max. Returns 0 if there are fewer notes than MIN_CLUSTERS,
 * signalling that clustering should be skipped.
 */
export function chooseK(
  n: number,
  min: number = MIN_CLUSTERS,
  max: number = MAX_CLUSTERS,
): number {
  if (n < min) return 0;
  const k = Math.floor(Math.sqrt(n / 2));
  return Math.max(min, Math.min(k, max));
}

// ---------------------------------------------------------------------------
// Vector math helpers
// ---------------------------------------------------------------------------

/** Add vector b to vector a in place. */
function addInPlace(a: number[], b: number[]): void {
  for (let i = 0; i < a.length; i++) {
    a[i] += b[i];
  }
}

/** Scale vector a by scalar s in place. */
function scaleInPlace(a: number[], s: number): void {
  for (let i = 0; i < a.length; i++) {
    a[i] *= s;
  }
}

/** Create a zero vector of given dimension. */
function zeroVector(dim: number): number[] {
  return new Array(dim).fill(0);
}

/**
 * Squared Euclidean distance between two vectors.
 * Used for cluster assignment (avoids sqrt for performance).
 */
export function squaredDistance(a: EmbeddingVector, b: EmbeddingVector): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return sum;
}

// ---------------------------------------------------------------------------
// K-Means
// ---------------------------------------------------------------------------

/** Result of a single k-means run. */
export interface KMeansResult {
  /** Cluster assignments: assignments[i] is the cluster index for point i. */
  assignments: number[];
  /** Centroid vectors, one per cluster. */
  centroids: EmbeddingVector[];
  /** Number of iterations until convergence (or max). */
  iterations: number;
}

/**
 * Initialize centroids using k-means++ seeding for better convergence.
 *
 * Selects the first centroid uniformly at random, then each subsequent
 * centroid is chosen with probability proportional to its squared distance
 * from the nearest existing centroid.
 */
export function kmeansppInit(
  vectors: EmbeddingVector[],
  k: number,
  rng: () => number = Math.random,
): EmbeddingVector[] {
  const n = vectors.length;
  const centroids: EmbeddingVector[] = [];

  // Pick first centroid uniformly at random
  const firstIdx = Math.floor(rng() * n);
  centroids.push([...vectors[firstIdx]]);

  // Distance from each point to its nearest centroid
  const distances = new Array<number>(n).fill(Infinity);

  for (let c = 1; c < k; c++) {
    // Update distances with the newly added centroid
    const latest = centroids[c - 1];
    for (let i = 0; i < n; i++) {
      const d = squaredDistance(vectors[i], latest);
      if (d < distances[i]) {
        distances[i] = d;
      }
    }

    // Weighted random selection
    let totalWeight = 0;
    for (let i = 0; i < n; i++) totalWeight += distances[i];

    let r = rng() * totalWeight;
    let chosen = 0;
    for (let i = 0; i < n; i++) {
      r -= distances[i];
      if (r <= 0) {
        chosen = i;
        break;
      }
    }

    centroids.push([...vectors[chosen]]);
  }

  return centroids;
}

/**
 * Run k-means clustering on a set of vectors.
 *
 * @param vectors        - The embedding vectors to cluster.
 * @param k              - Number of clusters.
 * @param maxIterations  - Maximum iterations before stopping.
 * @param initCentroids  - Optional pre-computed initial centroids.
 */
export function kmeans(
  vectors: EmbeddingVector[],
  k: number,
  maxIterations: number = KMEANS_MAX_ITERATIONS,
  initCentroids?: EmbeddingVector[],
): KMeansResult {
  const n = vectors.length;
  const dim = vectors[0].length;

  // Initialize centroids
  let centroids: EmbeddingVector[] = initCentroids
    ? initCentroids.map((c) => [...c])
    : kmeansppInit(vectors, k);

  let assignments = new Array<number>(n).fill(0);
  let iterations = 0;

  for (let iter = 0; iter < maxIterations; iter++) {
    iterations = iter + 1;
    let changed = false;

    // Assignment step: assign each point to its nearest centroid
    for (let i = 0; i < n; i++) {
      let bestCluster = 0;
      let bestDist = Infinity;

      for (let c = 0; c < k; c++) {
        const dist = squaredDistance(vectors[i], centroids[c]);
        if (dist < bestDist) {
          bestDist = dist;
          bestCluster = c;
        }
      }

      if (assignments[i] !== bestCluster) {
        assignments[i] = bestCluster;
        changed = true;
      }
    }

    // If no assignments changed, we've converged
    if (!changed) break;

    // Update step: recompute centroids as mean of assigned points
    const newCentroids: EmbeddingVector[] = [];
    const counts = new Array<number>(k).fill(0);

    for (let c = 0; c < k; c++) {
      newCentroids.push(zeroVector(dim));
    }

    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      addInPlace(newCentroids[c], vectors[i]);
      counts[c]++;
    }

    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        scaleInPlace(newCentroids[c], 1 / counts[c]);
      } else {
        // Empty cluster — keep old centroid
        newCentroids[c] = [...centroids[c]];
      }
    }

    centroids = newCentroids;
  }

  return { assignments, centroids, iterations };
}

// ---------------------------------------------------------------------------
// High-level clustering
// ---------------------------------------------------------------------------

/**
 * Cluster an embeddings index into semantic groups.
 *
 * Returns a ClustersIndex ready for persistence. If there are too few
 * notes, returns an empty index.
 */
export function clusterEmbeddings(
  index: EmbeddingsIndex,
  options?: { k?: number; maxIterations?: number },
): ClustersIndex {
  const noteIds = Object.keys(index.embeddings);
  const now = new Date().toISOString();

  if (noteIds.length === 0) {
    return { clusters: {}, computedAt: now };
  }

  const k = options?.k ?? chooseK(noteIds.length);

  if (k === 0) {
    // Not enough notes for meaningful clustering
    return { clusters: {}, computedAt: now };
  }

  const vectors = noteIds.map((id) => index.embeddings[id].vector);
  const result = kmeans(vectors, k, options?.maxIterations);

  // Build cluster records from assignments
  const clusterMap: Record<string, { noteIds: NoteId[]; centroid: EmbeddingVector }> = {};

  for (let c = 0; c < k; c++) {
    clusterMap[`cluster-${c}`] = {
      noteIds: [],
      centroid: result.centroids[c],
    };
  }

  for (let i = 0; i < noteIds.length; i++) {
    const clusterId = `cluster-${result.assignments[i]}`;
    clusterMap[clusterId].noteIds.push(noteIds[i]);
  }

  // Convert to ClustersIndex, filtering out empty clusters
  const clusters: Record<string, Cluster> = {};

  for (const [id, data] of Object.entries(clusterMap)) {
    if (data.noteIds.length === 0) continue;

    clusters[id] = {
      id,
      centroid: data.centroid,
      noteIds: data.noteIds.sort(),
      createdAt: now,
      updatedAt: now,
    };
  }

  return { clusters, computedAt: now };
}
