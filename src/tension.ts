/**
 * Tension detection module — find divergent note pairs within clusters.
 *
 * Pure math, no external dependencies. Scans each semantic cluster for
 * pairs of notes whose embeddings are dissimilar enough to suggest a
 * conceptual conflict. Two notes in the same cluster share a topic; if
 * their cosine similarity is below the tension threshold they are
 * pulling in different directions within that topic — a tension worth
 * surfacing.
 */

import type { EmbeddingsIndex } from "@/types";
import type { ClustersIndex } from "@/types";
import type { Tension, TensionsIndex } from "@/types";
import { cosineSimilarity } from "./similarity";
import { TENSION_THRESHOLD } from "./config";

// ---------------------------------------------------------------------------
// Core detection
// ---------------------------------------------------------------------------

/**
 * Detect tensions across all clusters.
 *
 * For each cluster with 2+ notes, computes pairwise cosine similarity
 * between all members. Pairs whose similarity falls below the tension
 * threshold are flagged — they share a topic (same cluster) but diverge
 * semantically.
 *
 * @param embeddingsIndex  - The full embeddings index from PrivateBox.
 * @param clustersIndex    - The clusters index from PrivateBox.
 * @param threshold        - Maximum similarity to flag as tension (defaults to config).
 */
export function detectTensions(
  embeddingsIndex: EmbeddingsIndex,
  clustersIndex: ClustersIndex,
  threshold: number = TENSION_THRESHOLD,
): TensionsIndex {
  const now = new Date().toISOString();
  const tensions: Record<string, Tension> = {};
  let counter = 0;

  for (const cluster of Object.values(clustersIndex.clusters)) {
    const noteIds = cluster.noteIds;

    if (noteIds.length < 2) continue;

    // Check all pairs within this cluster
    for (let i = 0; i < noteIds.length; i++) {
      for (let j = i + 1; j < noteIds.length; j++) {
        const noteA = noteIds[i];
        const noteB = noteIds[j];

        const embA = embeddingsIndex.embeddings[noteA];
        const embB = embeddingsIndex.embeddings[noteB];

        // Skip if either embedding is missing (defensive)
        if (!embA || !embB) continue;

        const similarity = cosineSimilarity(embA.vector, embB.vector);

        if (similarity < threshold) {
          const id = `tension-${counter}`;
          // Canonical ordering: smaller ID first
          const [first, second] =
            noteA < noteB ? [noteA, noteB] : [noteB, noteA];

          tensions[id] = {
            id,
            noteA: first,
            noteB: second,
            similarity,
            clusterId: cluster.id,
            detectedAt: now,
          };
          counter++;
        }
      }
    }
  }

  return { tensions, computedAt: now };
}
