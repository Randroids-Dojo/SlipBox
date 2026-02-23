/**
 * Decay types for the SlipBox semantic engine.
 *
 * Decay records identify notes that may be stale or under-connected:
 * isolated (no links), sparsely connected (few links), outliers within
 * their cluster, or unclustered entirely. Higher scores indicate greater
 * staleness risk.
 *
 * Stored as /index/decay.json in PrivateBox.
 */

import type { NoteId } from "./note";

/**
 * The reason(s) a note received a staleness score.
 *
 * - `no-links`          — note has zero backlinks (+0.4)
 * - `low-link-density`  — note has fewer than 2 backlinks (+0.2)
 * - `cluster-outlier`   — note's similarity to its cluster centroid is below
 *                         the outlier threshold (+0.3)
 * - `no-cluster`        — note does not appear in any cluster (+0.1)
 */
export type DecayReason =
  | "no-links"
  | "low-link-density"
  | "cluster-outlier"
  | "no-cluster";

/** A staleness record for a single note. */
export interface DecayRecord {
  /** The note this record describes. */
  noteId: NoteId;
  /**
   * Aggregated staleness score in [0, 1].
   * Summed from per-reason contributions, capped at 1.0.
   */
  score: number;
  /** Reasons that contributed to the score. */
  reasons: DecayReason[];
  /** ISO-8601 timestamp of when this record was computed. */
  computedAt: string;
}

/**
 * The full decay index stored in PrivateBox at /index/decay.json.
 *
 * Only notes whose score meets or exceeds DECAY_SCORE_THRESHOLD are
 * included. Notes not present here are considered healthy.
 */
export interface DecayIndex {
  /** Map of note IDs to decay records. */
  records: Record<NoteId, DecayRecord>;
  /** ISO-8601 timestamp of when the decay pass was last run. */
  computedAt: string;
}

/** Create an empty decay index for bootstrapping. */
export const emptyDecayIndex = (): DecayIndex => ({
  records: {},
  computedAt: new Date().toISOString(),
});
