/**
 * Exploration module — detect structural gaps in the knowledge graph.
 *
 * Pure computation, no external dependencies. Scans four types of gaps:
 *
 *   orphan-note       — notes in the embeddings index with zero backlinks
 *   close-clusters    — cluster pairs with centroid similarity > threshold
 *   structural-hole   — clusters with no typed relations to external notes
 *   meta-note-missing — clusters where no member note has `type: meta`
 */

import type {
  EmbeddingsIndex,
  BacklinksIndex,
  ClustersIndex,
  RelationsIndex,
  ExplorationSuggestion,
  ExplorationsIndex,
} from "@/types";
import { cosineSimilarity } from "./similarity";
import { CLOSE_CLUSTER_THRESHOLD } from "./config";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ExplorationConfig {
  /** Centroid similarity above which two clusters are flagged as close (default: config). */
  closeClusterThreshold?: number;
  /**
   * Set of note IDs that have `type: meta` in frontmatter.
   * Required for `meta-note-missing` detection. If not provided, that check is skipped.
   */
  metaNoteIds?: Set<string>;
}

// ---------------------------------------------------------------------------
// Core detection
// ---------------------------------------------------------------------------

/**
 * Detect structural gaps in the knowledge graph.
 *
 * @param embeddingsIndex  - The full embeddings index.
 * @param backlinksIndex   - The backlinks index.
 * @param clustersIndex    - The clusters index.
 * @param relationsIndex   - The typed relations index.
 * @param config           - Optional overrides and context (metaNoteIds, threshold).
 */
export function detectExplorations(
  embeddingsIndex: EmbeddingsIndex,
  backlinksIndex: BacklinksIndex,
  clustersIndex: ClustersIndex,
  relationsIndex: RelationsIndex,
  config: ExplorationConfig = {},
): ExplorationsIndex {
  const now = new Date().toISOString();
  const threshold = config.closeClusterThreshold ?? CLOSE_CLUSTER_THRESHOLD;
  const suggestions: ExplorationSuggestion[] = [];
  let counter = 0;

  // 1. Orphan notes — in embeddings but with zero backlinks
  for (const noteId of Object.keys(embeddingsIndex.embeddings)) {
    const links = backlinksIndex.links[noteId] ?? [];
    if (links.length === 0) {
      suggestions.push({
        id: `exploration-${++counter}`,
        type: "orphan-note",
        noteId,
        detectedAt: now,
      });
    }
  }

  // 2. Close clusters — centroid pairs above similarity threshold
  const clusters = Object.values(clustersIndex.clusters);
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const a = clusters[i];
      const b = clusters[j];
      const sim = cosineSimilarity(a.centroid, b.centroid);
      if (sim > threshold) {
        const [clusterA, clusterB] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
        suggestions.push({
          id: `exploration-${++counter}`,
          type: "close-clusters",
          clusterA,
          clusterB,
          similarity: sim,
          detectedAt: now,
        });
      }
    }
  }

  // 3. Structural holes — clusters with no typed relations to external notes
  const relations = Object.values(relationsIndex.relations);
  for (const cluster of clusters) {
    const memberSet = new Set(cluster.noteIds);
    const hasExternalRelation = relations.some((rel) => {
      // A relation is external if exactly one endpoint is in this cluster
      const aIn = memberSet.has(rel.noteA);
      const bIn = memberSet.has(rel.noteB);
      return aIn !== bIn;
    });
    if (!hasExternalRelation) {
      suggestions.push({
        id: `exploration-${++counter}`,
        type: "structural-hole",
        clusterId: cluster.id,
        detectedAt: now,
      });
    }
  }

  // 4. Meta-note missing — clusters with no member that has type: meta
  if (config.metaNoteIds) {
    const metaIds = config.metaNoteIds;
    for (const cluster of clusters) {
      const hasMeta = cluster.noteIds.some((id) => metaIds.has(id));
      if (!hasMeta) {
        suggestions.push({
          id: `exploration-${++counter}`,
          type: "meta-note-missing",
          clusterId: cluster.id,
          detectedAt: now,
        });
      }
    }
  }

  return { suggestions, computedAt: now };
}
