/**
 * Relation module — manage typed semantic edges between notes.
 *
 * Relations sit on top of similarity-based backlinks and carry LLM-annotated
 * semantic types. This module handles canonical key derivation, upserts,
 * filtering by note, and serialization.
 *
 * Pure logic — no external dependencies, no I/O.
 */

import type { NoteId, RelationType, TypedLink, RelationsIndex } from "@/types";
import { RELATION_TYPES, emptyRelationsIndex } from "@/types";

export { emptyRelationsIndex };

// ---------------------------------------------------------------------------
// Canonical key
// ---------------------------------------------------------------------------

/**
 * Derive a canonical key for a note pair.
 *
 * Keys are always `${smaller}:${larger}` so that the same pair of notes
 * always maps to the same key regardless of argument order.
 */
export function canonicalKey(noteA: NoteId, noteB: NoteId): string {
  return noteA < noteB ? `${noteA}:${noteB}` : `${noteB}:${noteA}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Returns true if the given string is a valid RelationType. */
export function isValidRelationType(value: string): value is RelationType {
  return (RELATION_TYPES as string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Upsert
// ---------------------------------------------------------------------------

/**
 * Upsert a typed link into the relations index.
 *
 * If a record already exists for the canonical pair key it is overwritten.
 * The index's `updatedAt` timestamp is refreshed on every call.
 *
 * @param index      - The relations index to mutate in place.
 * @param noteA      - One note of the pair (order does not matter).
 * @param noteB      - The other note of the pair.
 * @param relationType - The classified relation type.
 * @param reason     - One-sentence LLM annotation.
 * @param similarity - Cosine similarity from the backlinks index.
 * @param classifiedAt - ISO-8601 timestamp; defaults to now.
 */
export function upsertRelation(
  index: RelationsIndex,
  noteA: NoteId,
  noteB: NoteId,
  relationType: RelationType,
  reason: string,
  similarity: number,
  classifiedAt: string = new Date().toISOString(),
): void {
  const [first, second] = noteA < noteB ? [noteA, noteB] : [noteB, noteA];
  const key = `${first}:${second}`;

  index.relations[key] = {
    noteA: first,
    noteB: second,
    relationType,
    reason,
    similarity,
    classifiedAt,
  };

  index.updatedAt = new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/**
 * Return all typed links that involve a given note (as either noteA or noteB).
 */
export function getRelationsForNote(
  index: RelationsIndex,
  noteId: NoteId,
): TypedLink[] {
  return Object.values(index.relations).filter(
    (link) => link.noteA === noteId || link.noteB === noteId,
  );
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a relations index to a JSON string.
 */
export function serializeRelationsIndex(index: RelationsIndex): string {
  return JSON.stringify(index, null, 2) + "\n";
}

/**
 * Deserialize a relations index from a JSON string.
 */
export function deserializeRelationsIndex(json: string): RelationsIndex {
  return JSON.parse(json) as RelationsIndex;
}
