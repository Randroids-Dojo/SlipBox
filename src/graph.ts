/**
 * Graph module — bidirectional backlink management and serialization.
 *
 * Manages the backlinks index: a bidirectional adjacency list where
 * each link between two notes is recorded on both sides. Links are
 * always symmetric: if A→B exists, then B→A exists with the same
 * similarity score.
 */

import { emptyBacklinksIndex, type NoteId, type NoteLink, type BacklinksIndex } from "@/types";

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/**
 * Get all links for a given note ID from the backlinks index.
 * Returns an empty array if the note has no links.
 */
export function getLinks(index: BacklinksIndex, noteId: NoteId): NoteLink[] {
  return index.links[noteId] ?? [];
}

// ---------------------------------------------------------------------------
// Mutation helpers
// ---------------------------------------------------------------------------

/**
 * Add a bidirectional link between two notes.
 *
 * If a link between the two notes already exists, it is updated with the
 * new similarity score. The link is recorded on both sides of the adjacency list.
 */
export function addLink(
  index: BacklinksIndex,
  noteA: NoteId,
  noteB: NoteId,
  similarity: number,
): void {
  if (noteA === noteB) return;

  upsertDirectedLink(index, noteA, noteB, similarity);
  upsertDirectedLink(index, noteB, noteA, similarity);
}

/**
 * Remove a bidirectional link between two notes.
 *
 * Silently does nothing if the link does not exist.
 */
export function removeLink(
  index: BacklinksIndex,
  noteA: NoteId,
  noteB: NoteId,
): void {
  removeDirectedLink(index, noteA, noteB);
  removeDirectedLink(index, noteB, noteA);
}

/**
 * Apply a set of similarity matches to the backlinks index for a given note.
 *
 * Each match becomes a bidirectional link. Existing links for the source note
 * that are not in the new matches are left unchanged (this is additive).
 */
export function applyMatches(
  index: BacklinksIndex,
  sourceId: NoteId,
  matches: NoteLink[],
): void {
  for (const match of matches) {
    addLink(index, sourceId, match.targetId, match.similarity);
  }
}

/**
 * Rebuild the entire backlinks index from scratch given a full set of
 * link pairs. Used by the link-pass endpoint to recompute all links.
 */
export function rebuildBacklinks(
  linkPairs: { noteA: NoteId; noteB: NoteId; similarity: number }[],
): BacklinksIndex {
  const index = emptyBacklinksIndex();
  for (const pair of linkPairs) {
    addLink(index, pair.noteA, pair.noteB, pair.similarity);
  }
  return index;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Insert or update a one-directional link in the adjacency list. */
function upsertDirectedLink(
  index: BacklinksIndex,
  from: NoteId,
  to: NoteId,
  similarity: number,
): void {
  if (!index.links[from]) {
    index.links[from] = [];
  }

  const existing = index.links[from].find((l) => l.targetId === to);
  if (existing) {
    existing.similarity = similarity;
  } else {
    index.links[from].push({ targetId: to, similarity });
  }
}

/** Remove a one-directional link from the adjacency list. */
function removeDirectedLink(
  index: BacklinksIndex,
  from: NoteId,
  to: NoteId,
): void {
  if (!index.links[from]) return;
  index.links[from] = index.links[from].filter((l) => l.targetId !== to);
  if (index.links[from].length === 0) {
    delete index.links[from];
  }
}
