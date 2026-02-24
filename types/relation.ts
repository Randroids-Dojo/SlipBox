/**
 * Relation types for the SlipBox semantic engine.
 *
 * Relations are typed semantic edges between notes — a richer layer on top
 * of the similarity-based backlinks. They are classified by a local LLM
 * agent via the GET /api/link-data → POST /api/relations pipeline.
 *
 * Stored as /index/relations.json in PrivateBox.
 */

import type { NoteId } from "./note";

/**
 * The vocabulary of semantic edge types.
 *
 * - supports:        noteA provides evidence or reasoning that strengthens noteB.
 * - contradicts:     noteA and noteB make conflicting claims.
 * - refines:         noteA adds precision or nuance to the idea in noteB.
 * - is-example-of:   noteA is a concrete instance of the concept in noteB.
 * - contrasts-with:  noteA and noteB highlight different aspects of the same topic.
 */
/** All valid relation types, useful for validation. */
export const RELATION_TYPES = [
  "supports",
  "contradicts",
  "refines",
  "is-example-of",
  "contrasts-with",
] as const;

export type RelationType = typeof RELATION_TYPES[number];

/** A typed semantic edge between two notes. */
export interface TypedLink {
  /** First note in canonical order (the smaller note ID). */
  noteA: NoteId;
  /** Second note in canonical order (the larger note ID). */
  noteB: NoteId;
  /** The semantic relationship from noteA's perspective toward noteB. */
  relationType: RelationType;
  /** One-sentence LLM annotation explaining the classification. */
  reason: string;
  /** Cosine similarity score from the backlinks index at classification time. */
  similarity: number;
  /** ISO-8601 timestamp of when this relation was classified. */
  classifiedAt: string;
}

/**
 * The full relations index stored in PrivateBox at /index/relations.json.
 *
 * Keyed by canonical pair key `${noteA}:${noteB}` where noteA < noteB
 * lexicographically. One entry per note pair; upserts overwrite the existing
 * record for a pair.
 */
export interface RelationsIndex {
  /** Map of canonical pair keys to typed link records. */
  relations: Record<string, TypedLink>;
  /** ISO-8601 timestamp of when the index was last updated. */
  updatedAt: string;
}

/** Create an empty relations index for bootstrapping. */
export const emptyRelationsIndex = (): RelationsIndex => ({
  relations: {},
  updatedAt: new Date().toISOString(),
});
