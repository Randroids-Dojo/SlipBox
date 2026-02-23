/**
 * Tension types for the SlipBox semantic engine.
 *
 * Tensions represent pairs of notes within the same semantic cluster
 * that diverge significantly — they share a topic but pull in different
 * directions. These surface potential contradictions or unresolved
 * conceptual conflicts worth examining.
 *
 * Stored as /index/tensions.json in PrivateBox.
 */

import type { NoteId } from "./note";

/** A detected tension between two notes in the same cluster. */
export interface Tension {
  /** Unique tension identifier (e.g. "tension-0"). */
  id: string;
  /** First note in the tension pair. */
  noteA: NoteId;
  /** Second note in the tension pair. */
  noteB: NoteId;
  /** Cosine similarity between the two notes. */
  similarity: number;
  /** The cluster both notes belong to. */
  clusterId: string;
  /** ISO-8601 timestamp of when the tension was detected. */
  detectedAt: string;
}

/**
 * The full tensions index stored in PrivateBox at /index/tensions.json.
 *
 * Each tension represents a pair of semantically related notes (same cluster)
 * whose embeddings diverge enough to suggest a conceptual conflict.
 * Tensions are recomputed in full on each tension-pass invocation.
 */
export interface TensionsIndex {
  /** Map of tension IDs to tension records. */
  tensions: Record<string, Tension>;
  /** ISO-8601 timestamp of when tensions were last computed. */
  computedAt: string;
}
