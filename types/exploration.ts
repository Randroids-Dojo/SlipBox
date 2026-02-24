/**
 * Exploration types for the SlipBox semantic engine.
 *
 * Exploration suggestions identify structural gaps in the knowledge graph:
 * isolated notes, overly similar clusters, clusters with no external
 * typed connections, and clusters lacking a synthesized meta-note.
 *
 * Stored as /index/explorations.json in PrivateBox.
 */

import type { NoteId } from "./note";

/**
 * The four structural gap types detected by the exploration pass.
 *
 * - `orphan-note`         — a note with zero backlinks
 * - `close-clusters`      — two clusters whose centroids are very similar (merge candidate)
 * - `structural-hole`     — a cluster with no typed relations to any note outside the cluster
 * - `meta-note-missing`   — a cluster where no member note has `type: meta` in frontmatter
 */
/** All valid exploration suggestion types. */
export const EXPLORATION_SUGGESTION_TYPES = [
  "orphan-note",
  "close-clusters",
  "structural-hole",
  "meta-note-missing",
] as const;

export type ExplorationSuggestionType =
  typeof EXPLORATION_SUGGESTION_TYPES[number];

/** A single structural gap suggestion. */
export interface ExplorationSuggestion {
  /** Unique suggestion identifier. */
  id: string;
  /** The type of structural gap. */
  type: ExplorationSuggestionType;
  /**
   * The orphan note ID.
   * Populated for `orphan-note` suggestions.
   */
  noteId?: NoteId;
  /**
   * First cluster ID in a close pair (lexicographically smaller).
   * Populated for `close-clusters` suggestions.
   */
  clusterA?: string;
  /**
   * Second cluster ID in a close pair.
   * Populated for `close-clusters` suggestions.
   */
  clusterB?: string;
  /**
   * Cosine similarity between the two cluster centroids.
   * Populated for `close-clusters` suggestions.
   */
  similarity?: number;
  /**
   * The cluster with a structural gap.
   * Populated for `structural-hole` and `meta-note-missing` suggestions.
   */
  clusterId?: string;
  /** ISO-8601 timestamp of when this suggestion was detected. */
  detectedAt: string;
}

/**
 * The full explorations index stored in PrivateBox at /index/explorations.json.
 *
 * Replaced entirely on each exploration-pass run (not append-only).
 */
export interface ExplorationsIndex {
  /** All structural gap suggestions found in the last pass. */
  suggestions: ExplorationSuggestion[];
  /** ISO-8601 timestamp of when the exploration pass was last run. */
  computedAt: string;
}

/** Create an empty explorations index for bootstrapping. */
export const emptyExplorationsIndex = (): ExplorationsIndex => ({
  suggestions: [],
  computedAt: new Date().toISOString(),
});
