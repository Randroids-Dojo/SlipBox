/**
 * Similarity module — cosine similarity and threshold-based match finding.
 *
 * Pure math, no external dependencies. Given two vectors, computes their
 * cosine similarity. Given a target embedding and an index, returns ranked
 * matches above the configured threshold.
 */

import type { EmbeddingVector, EmbeddingsIndex, NoteId } from "@/types";
import type { NoteLink } from "@/types";
import { SIMILARITY_THRESHOLD } from "./config";

// ---------------------------------------------------------------------------
// Cosine Similarity
// ---------------------------------------------------------------------------

/**
 * Compute the cosine similarity between two vectors.
 *
 * Returns a value in [-1, 1] where 1 means identical direction,
 * 0 means orthogonal, and -1 means opposite direction.
 *
 * Throws if vectors have different lengths or either has zero magnitude.
 */
export function cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vector length mismatch: ${a.length} vs ${b.length}`,
    );
  }

  if (a.length === 0) {
    throw new Error("Cannot compute similarity of empty vectors");
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(magA) * Math.sqrt(magB);

  if (magnitude === 0) {
    throw new Error("Cannot compute similarity: zero magnitude vector");
  }

  return dot / magnitude;
}

// ---------------------------------------------------------------------------
// Match Finding
// ---------------------------------------------------------------------------

/** A similarity match between a target and an indexed note. */
export interface SimilarityMatch {
  /** The matched note's ID. */
  noteId: NoteId;
  /** Cosine similarity score. */
  similarity: number;
}

/**
 * Find all notes in the embeddings index whose similarity to the target
 * vector exceeds the given threshold, sorted by similarity descending.
 *
 * @param target     - The embedding vector to compare against.
 * @param index      - The full embeddings index from PrivateBox.
 * @param threshold  - Minimum similarity score (defaults to config value).
 * @param excludeIds - Note IDs to skip (e.g. the note being compared).
 */
export function findMatches(
  target: EmbeddingVector,
  index: EmbeddingsIndex,
  threshold: number = SIMILARITY_THRESHOLD,
  excludeIds: Set<NoteId> = new Set(),
): SimilarityMatch[] {
  const matches: SimilarityMatch[] = [];

  for (const [noteId, record] of Object.entries(index.embeddings)) {
    if (excludeIds.has(noteId)) continue;

    const similarity = cosineSimilarity(target, record.vector);

    if (similarity >= threshold) {
      matches.push({ noteId, similarity });
    }
  }

  // Sort descending by similarity
  matches.sort((a, b) => b.similarity - a.similarity);

  return matches;
}

/**
 * Convert similarity matches into NoteLink objects suitable for
 * attaching to a Note's links array.
 */
export function matchesToLinks(matches: SimilarityMatch[]): NoteLink[] {
  return matches.map((m) => ({
    targetId: m.noteId,
    similarity: m.similarity,
  }));
}
