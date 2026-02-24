/**
 * Snapshot types for the SlipBox graph analytics engine.
 *
 * Snapshots capture a point-in-time summary of the knowledge graph:
 * note counts, link density, cluster distribution, tension and decay
 * counts. They are accumulated in an append-only timeline to track
 * how the graph evolves over time.
 *
 * Stored as /index/snapshots.json in PrivateBox.
 */

/**
 * A single point-in-time snapshot of the knowledge graph.
 *
 * One snapshot is captured per nightly run and appended to the
 * SnapshotsIndex. Snapshots are immutable after creation.
 */
export interface GraphSnapshot {
  /** Unique snapshot identifier (e.g. "snapshot-1700000000000"). */
  id: string;
  /** ISO-8601 timestamp of when the snapshot was captured. */
  capturedAt: string;
  /** Total number of notes in the embeddings index. */
  noteCount: number;
  /** Number of unique link pairs (bidirectional links counted once). */
  linkCount: number;
  /** Number of clusters in the clusters index. */
  clusterCount: number;
  /** Number of tensions in the tensions index. */
  tensionCount: number;
  /** Number of records in the decay index. */
  decayCount: number;
  /** Map of clusterId to the number of notes in that cluster. */
  clusterSizes: Record<string, number>;
  /** Average number of directed backlinks per note (total directed links / noteCount). */
  avgLinksPerNote: number;
}

/**
 * The full snapshots index stored in PrivateBox at /index/snapshots.json.
 *
 * Append-only: snapshots are only ever added, never removed or updated.
 * Ordered by capturedAt ascending.
 */
export interface SnapshotsIndex {
  /** Ordered array of snapshots, oldest first. */
  snapshots: GraphSnapshot[];
}

/** Create an empty snapshots index for bootstrapping. */
export const emptySnapshotsIndex = (): SnapshotsIndex => ({
  snapshots: [],
});
