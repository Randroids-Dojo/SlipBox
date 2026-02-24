/**
 * Snapshot module — capture a point-in-time summary of the knowledge graph.
 *
 * Pure computation, no external dependencies. Takes all five live indexes
 * and produces a GraphSnapshot recording counts and density metrics.
 */

import type { EmbeddingsIndex } from "@/types";
import type { BacklinksIndex } from "@/types";
import type { ClustersIndex } from "@/types";
import type { TensionsIndex } from "@/types";
import type { DecayIndex } from "@/types";
import type { GraphSnapshot } from "@/types";

/**
 * Capture a point-in-time snapshot of the knowledge graph.
 *
 * @param embeddingsIndex  - The full embeddings index.
 * @param backlinksIndex   - The backlinks index (bidirectional links).
 * @param clustersIndex    - The clusters index.
 * @param tensionsIndex    - The tensions index.
 * @param decayIndex       - The decay index.
 */
export function captureSnapshot(
  embeddingsIndex: EmbeddingsIndex,
  backlinksIndex: BacklinksIndex,
  clustersIndex: ClustersIndex,
  tensionsIndex: TensionsIndex,
  decayIndex: DecayIndex,
): GraphSnapshot {
  const id = `snapshot-${Date.now()}`;
  const capturedAt = new Date().toISOString();

  const noteCount = Object.keys(embeddingsIndex.embeddings).length;

  // Count unique undirected pairs: only record (A, B) where A < B
  let linkCount = 0;
  for (const [noteId, links] of Object.entries(backlinksIndex.links)) {
    for (const link of links) {
      if (noteId < link.targetId) {
        linkCount++;
      }
    }
  }

  const clusterCount = Object.keys(clustersIndex.clusters).length;
  const tensionCount = Object.keys(tensionsIndex.tensions).length;
  const decayCount = Object.keys(decayIndex.records).length;

  const clusterSizes: Record<string, number> = {};
  for (const [clusterId, cluster] of Object.entries(clustersIndex.clusters)) {
    clusterSizes[clusterId] = cluster.noteIds.length;
  }

  // avgLinksPerNote: sum of all directed link counts / noteCount
  let totalDirectedLinks = 0;
  for (const links of Object.values(backlinksIndex.links)) {
    totalDirectedLinks += links.length;
  }
  const avgLinksPerNote = noteCount === 0 ? 0 : totalDirectedLinks / noteCount;

  return {
    id,
    capturedAt,
    noteCount,
    linkCount,
    clusterCount,
    tensionCount,
    decayCount,
    clusterSizes,
    avgLinksPerNote,
  };
}
