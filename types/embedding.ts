/**
 * Embedding types for the SlipBox semantic engine.
 *
 * Embeddings map note content into vector space for similarity computation.
 */

import type { NoteId } from "./note";

/** A dense vector representing a note's semantic position. */
export type EmbeddingVector = number[];

/** An embedding record stored in the embeddings index. */
export interface NoteEmbedding {
  /** The note this embedding belongs to. */
  noteId: NoteId;
  /** The dense embedding vector. */
  vector: EmbeddingVector;
  /** Identifier of the model that produced this embedding (e.g. "text-embedding-3-large"). */
  model: string;
  /** ISO-8601 timestamp of when the embedding was generated. */
  createdAt: string;
}

/** The full embeddings index stored in PrivateBox at /index/embeddings.json. */
export interface EmbeddingsIndex {
  /** Map of note IDs to their embedding records. */
  embeddings: Record<NoteId, NoteEmbedding>;
}
