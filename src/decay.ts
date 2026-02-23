/**
 * Decay detection module — identify stale or under-connected notes.
 *
 * Pure math, no external dependencies. Scores each note on four
 * independent staleness signals and produces a DecayIndex with
 * notes whose scores meet the configured threshold.
 *
 * Scoring components (additive, capped at 1.0):
 *   +0.4  no-links          — zero backlinks
 *   +0.2  low-link-density  — fewer than 2 backlinks
 *   +0.3  cluster-outlier   — cosine similarity to cluster centroid < threshold
 *   +0.1  no-cluster        — note not present in any cluster
 */

import type { EmbeddingsIndex } from "@/types";
import type { BacklinksIndex } from "@/types";
import type { ClustersIndex } from "@/types";
import type { DecayIndex, DecayRecord, DecayReason } from "@/types";
import { cosineSimilarity } from "./similarity";
import {
  CLUSTER_OUTLIER_THRESHOLD,
  DECAY_SCORE_THRESHOLD,
} from "./config";

// ---------------------------------------------------------------------------
// Score weights
// ---------------------------------------------------------------------------

const WEIGHT_NO_LINKS = 0.4;
const WEIGHT_LOW_LINK_DENSITY = 0.2;
const WEIGHT_CLUSTER_OUTLIER = 0.3;
const WEIGHT_NO_CLUSTER = 0.1;

/** Minimum backlink count before the low-link-density penalty is waived. */
const MIN_LINK_COUNT = 2;

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

/**
 * Compute decay scores for all notes in the embeddings index.
 *
 * Only notes with a score >= threshold are included in the result.
 * Notes not present in the result are considered healthy.
 *
 * @param embeddingsIndex   - The full embeddings index from PrivateBox.
 * @param backlinksIndex    - The backlinks index from PrivateBox.
 * @param clustersIndex     - The clusters index from PrivateBox.
 * @param outlierThreshold  - Max centroid similarity before outlier penalty (defaults to config).
 * @param scoreThreshold    - Min score to include in result (defaults to config).
 */
export function computeDecay(
  embeddingsIndex: EmbeddingsIndex,
  backlinksIndex: BacklinksIndex,
  clustersIndex: ClustersIndex,
  outlierThreshold: number = CLUSTER_OUTLIER_THRESHOLD,
  scoreThreshold: number = DECAY_SCORE_THRESHOLD,
): DecayIndex {
  const now = new Date().toISOString();
  const records: Record<string, DecayRecord> = {};

  // Build a lookup: noteId → { clusterId, centroid }
  const noteClusterMap = buildNoteClusterMap(clustersIndex);

  for (const noteId of Object.keys(embeddingsIndex.embeddings)) {
    const reasons: DecayReason[] = [];
    let score = 0;

    // --- Link signals ---
    const links = backlinksIndex.links[noteId] ?? [];
    const linkCount = links.length;

    if (linkCount === 0) {
      reasons.push("no-links");
      score += WEIGHT_NO_LINKS;
    }

    if (linkCount < MIN_LINK_COUNT) {
      reasons.push("low-link-density");
      score += WEIGHT_LOW_LINK_DENSITY;
    }

    // --- Cluster signals ---
    const clusterEntry = noteClusterMap[noteId];

    if (!clusterEntry) {
      reasons.push("no-cluster");
      score += WEIGHT_NO_CLUSTER;
    } else {
      const embedding = embeddingsIndex.embeddings[noteId];
      const sim = cosineSimilarity(embedding.vector, clusterEntry.centroid);

      if (sim < outlierThreshold) {
        reasons.push("cluster-outlier");
        score += WEIGHT_CLUSTER_OUTLIER;
      }
    }

    // Cap at 1.0
    score = Math.min(score, 1.0);

    if (score >= scoreThreshold) {
      records[noteId] = { noteId, score, reasons, computedAt: now };
    }
  }

  return { records, computedAt: now };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ClusterEntry {
  clusterId: string;
  centroid: number[];
}

/** Build a map from noteId to the cluster it belongs to (first match wins). */
function buildNoteClusterMap(
  clustersIndex: ClustersIndex,
): Record<string, ClusterEntry> {
  const map: Record<string, ClusterEntry> = {};

  for (const cluster of Object.values(clustersIndex.clusters)) {
    for (const noteId of cluster.noteIds) {
      if (!map[noteId]) {
        map[noteId] = { clusterId: cluster.id, centroid: cluster.centroid };
      }
    }
  }

  return map;
}
