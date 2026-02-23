/**
 * Core note types for the SlipBox Zettelkasten engine.
 *
 * A note is an atomic idea with metadata, timestamps, and semantic links.
 */

/** Unique identifier for a note (timestamp + hash). */
export type NoteId = string;

/**
 * Semantic type of a note. Omitted for regular atomic notes.
 *
 * - `meta`       — AI-generated cluster summary (Phase 3)
 * - `hypothesis` — AI-generated research hypothesis from a tension (Phase 4)
 */
export type NoteType = "meta" | "hypothesis";

/** All valid note types, useful for validation. */
export const NOTE_TYPES: NoteType[] = ["meta", "hypothesis"];

/** Frontmatter metadata attached to every note. */
export interface NoteMetadata {
  /** Human-readable title (optional, derived from content if omitted). */
  title?: string;
  /** Semantic note type. Omitted for regular atomic notes. */
  type?: NoteType;
  /** Free-form tags for manual categorization. */
  tags: string[];
  /** Source or origin of the idea (URL, book title, conversation, etc.). */
  source?: string;
}

/** A semantic link between two notes. */
export interface NoteLink {
  /** The ID of the linked note. */
  targetId: NoteId;
  /** Cosine similarity score at the time the link was created. */
  similarity: number;
}

/** A fully-formed atomic note. */
export interface Note {
  /** Unique note identifier. */
  id: NoteId;
  /** The atomic idea content (markdown body). */
  content: string;
  /** Structured metadata (frontmatter). */
  metadata: NoteMetadata;
  /** ISO-8601 timestamp of when the note was created. */
  createdAt: string;
  /** ISO-8601 timestamp of the last update. */
  updatedAt: string;
  /** Semantic links to other notes discovered by similarity. */
  links: NoteLink[];
}

/** Input payload for creating a new note (before ID generation and linking). */
export interface CreateNoteInput {
  /** Raw content string provided by the user. */
  content: string;
  /** Optional metadata overrides. */
  metadata?: Partial<NoteMetadata>;
}
