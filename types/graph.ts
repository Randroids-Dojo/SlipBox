/**
 * Graph types for the SlipBox backlink engine.
 *
 * The backlinks index stores bidirectional links between notes,
 * persisted as /index/backlinks.json in PrivateBox.
 */

import type { NoteId, NoteLink } from "./note";

/**
 * The full backlinks index stored in PrivateBox at /index/backlinks.json.
 *
 * Each key is a note ID, and its value is an array of links to other notes.
 * Links are always bidirectional: if A links to B, then B links to A.
 */
export interface BacklinksIndex {
  links: Record<NoteId, NoteLink[]>;
}
