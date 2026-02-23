/**
 * Note module — ID generation, content normalization, validation, and serialization.
 *
 * Given a raw content string, this module produces a well-formed Note object
 * ready for embedding and storage in PrivateBox.
 */

import { createHash } from "node:crypto";
import { NOTE_TYPES, type CreateNoteInput, type Note, type NoteId, type NoteMetadata, type NoteType } from "@/types";

// ---------------------------------------------------------------------------
// ID Generation
// ---------------------------------------------------------------------------

/**
 * Generate a unique note ID from the current timestamp and a content hash.
 * Format: `YYYYMMDDTHHMMSS-<8 hex chars>`
 *
 * The timestamp provides chronological ordering; the hash prevents collisions
 * when multiple notes are created within the same second.
 */
export function generateNoteId(content: string, now?: Date): NoteId {
  const date = now ?? new Date();
  const timestamp = date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "");
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 8);
  return `${timestamp}-${hash}`;
}

/** Regex for a valid note ID. */
export const NOTE_ID_PATTERN = /^\d{8}T\d{6}-[0-9a-f]{8}$/;

// ---------------------------------------------------------------------------
// Content Normalization
// ---------------------------------------------------------------------------

/**
 * Normalize raw content: trim surrounding whitespace and collapse runs of
 * three or more newlines down to a single blank line.
 */
export function normalizeContent(raw: string): string {
  return raw.trim().replace(/\n{3,}/g, "\n\n");
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a Note and return a list of error messages.
 * An empty array means the note is valid.
 */
export function validateNote(note: Note): string[] {
  const errors: string[] = [];

  if (!note.id) {
    errors.push("Note ID is required");
  } else if (!NOTE_ID_PATTERN.test(note.id)) {
    errors.push(`Invalid note ID format: ${note.id}`);
  }

  if (!note.content || note.content.trim().length === 0) {
    errors.push("Note content must not be empty");
  }

  if (!note.createdAt) {
    errors.push("createdAt timestamp is required");
  }

  if (!note.updatedAt) {
    errors.push("updatedAt timestamp is required");
  }

  if (!Array.isArray(note.metadata?.tags)) {
    errors.push("metadata.tags must be an array");
  }

  if (!Array.isArray(note.links)) {
    errors.push("links must be an array");
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Note Creation
// ---------------------------------------------------------------------------

/**
 * Build default NoteMetadata, merging any user-provided overrides.
 */
function buildMetadata(overrides?: Partial<NoteMetadata>): NoteMetadata {
  return {
    tags: [],
    ...overrides,
  };
}

/**
 * Create a fully-formed Note from raw user input.
 *
 * Normalizes content, generates a unique ID, sets timestamps, and
 * initializes an empty links array. Throws if content is empty after
 * normalization.
 */
export function createNote(input: CreateNoteInput, now?: Date): Note {
  const content = normalizeContent(input.content);

  if (content.length === 0) {
    throw new Error("Cannot create a note with empty content");
  }

  const date = now ?? new Date();
  const id = generateNoteId(content, date);
  const timestamp = date.toISOString();

  return {
    id,
    content,
    metadata: buildMetadata(input.metadata),
    createdAt: timestamp,
    updatedAt: timestamp,
    links: [],
  };
}

// ---------------------------------------------------------------------------
// Serialization (markdown with YAML frontmatter)
// ---------------------------------------------------------------------------

/**
 * Serialize a Note to markdown with YAML frontmatter, suitable for
 * committing to PrivateBox as a `.md` file.
 */
export function serializeNote(note: Note): string {
  const lines: string[] = ["---", `id: ${note.id}`];

  if (note.metadata.title) {
    lines.push(`title: "${note.metadata.title}"`);
  }

  if (note.metadata.type) {
    lines.push(`type: ${note.metadata.type}`);
  }

  if (note.metadata.tags.length > 0) {
    lines.push(
      `tags: [${note.metadata.tags.map((t) => `"${t}"`).join(", ")}]`,
    );
  }

  if (note.metadata.source) {
    lines.push(`source: "${note.metadata.source}"`);
  }

  lines.push(`created: ${note.createdAt}`);
  lines.push(`updated: ${note.updatedAt}`);

  if (note.links.length > 0) {
    lines.push("links:");
    for (const link of note.links) {
      lines.push(`  - target: ${link.targetId}`);
      lines.push(`    similarity: ${link.similarity}`);
    }
  }

  lines.push("---");

  return lines.join("\n") + "\n\n" + note.content + "\n";
}

/**
 * Return the PrivateBox file path for a given note ID.
 * e.g. `notes/20260222T153045-a1b2c3d4.md`
 */
export function noteFilePath(noteId: NoteId, notesDir: string): string {
  return `${notesDir}/${noteId}.md`;
}

// ---------------------------------------------------------------------------
// Deserialization
// ---------------------------------------------------------------------------

/**
 * Parse a serialized note markdown file back into its title and body.
 *
 * Strips the YAML frontmatter block and extracts the optional `title` field.
 * Returns the raw markdown body (everything after the closing `---`).
 */
export function parseNoteContent(markdown: string): {
  title?: string;
  type?: NoteType;
  body: string;
} {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
  if (!match) {
    return { body: markdown.trim() };
  }

  const frontmatter = match[1];
  const body = match[2].trim();

  const titleMatch = frontmatter.match(/^title:\s*"?(.+?)"?\s*$/m);
  const title = titleMatch ? titleMatch[1] : undefined;

  const typeMatch = frontmatter.match(/^type:\s*(\S+)\s*$/m);
  const rawType = typeMatch ? typeMatch[1] : undefined;
  const type =
    rawType && (NOTE_TYPES as string[]).includes(rawType)
      ? (rawType as NoteType)
      : undefined;

  return { title, type, body };
}
