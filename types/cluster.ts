/**
 * Cluster types for the SlipBox semantic engine.
 *
 * Clusters group semantically related notes into themes by partitioning
 * the embedding space. Stored as /index/clusters.json in PrivateBox.
 */

import type { NoteId } from "./note";
import type { EmbeddingVector } from "./embedding";

/** A semantic cluster of related notes. */
export interface Cluster {
  /** Unique cluster identifier (e.g. "cluster-0"). */
  id: string;
  /** Centroid vector — the mean embedding of all notes in this cluster. */
  centroid: EmbeddingVector;
  /** IDs of the notes assigned to this cluster. */
  noteIds: NoteId[];
  /** ISO-8601 timestamp of when this cluster was first created. */
  createdAt: string;
  /** ISO-8601 timestamp of when this cluster was last updated. */
  updatedAt: string;
}

/**
 * The full clusters index stored in PrivateBox at /index/clusters.json.
 *
 * Each cluster groups semantically related notes. Clusters are recomputed
 * in full on each cluster-pass invocation.
 */
export interface ClustersIndex {
  /** Map of cluster IDs to cluster records. */
  clusters: Record<string, Cluster>;
  /** ISO-8601 timestamp of when the clustering was last computed. */
  computedAt: string;
}
