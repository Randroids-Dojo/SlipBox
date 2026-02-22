import { describe, expect, it } from "vitest";
import {
  createNote,
  generateNoteId,
  normalizeContent,
  noteFilePath,
  NOTE_ID_PATTERN,
  serializeNote,
  validateNote,
} from "./note";
import type { Note } from "@/types";

// Fixed date for deterministic tests
const NOW = new Date("2026-02-22T15:30:45.123Z");

// ---------------------------------------------------------------------------
// generateNoteId
// ---------------------------------------------------------------------------

describe("generateNoteId", () => {
  it("produces the correct format: YYYYMMDDTHHMMSS-<8 hex>", () => {
    const id = generateNoteId("hello world", NOW);
    expect(id).toMatch(NOTE_ID_PATTERN);
    expect(id).toMatch(/^20260222T153045-/);
  });

  it("produces different hashes for different content", () => {
    const a = generateNoteId("alpha", NOW);
    const b = generateNoteId("beta", NOW);
    expect(a).not.toBe(b);
  });

  it("produces the same hash for the same content", () => {
    const a = generateNoteId("same input", NOW);
    const b = generateNoteId("same input", NOW);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// normalizeContent
// ---------------------------------------------------------------------------

describe("normalizeContent", () => {
  it("trims leading and trailing whitespace", () => {
    expect(normalizeContent("  hello  ")).toBe("hello");
  });

  it("collapses three or more newlines to two", () => {
    expect(normalizeContent("a\n\n\n\nb")).toBe("a\n\nb");
  });

  it("preserves single blank lines", () => {
    expect(normalizeContent("a\n\nb")).toBe("a\n\nb");
  });

  it("handles content that is only whitespace", () => {
    expect(normalizeContent("   \n\n  ")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// validateNote
// ---------------------------------------------------------------------------

describe("validateNote", () => {
  const validNote: Note = {
    id: "20260222T153045-abcd1234",
    content: "An atomic idea.",
    metadata: { tags: [] },
    createdAt: "2026-02-22T15:30:45.123Z",
    updatedAt: "2026-02-22T15:30:45.123Z",
    links: [],
  };

  it("returns no errors for a valid note", () => {
    expect(validateNote(validNote)).toEqual([]);
  });

  it("catches empty ID", () => {
    const errors = validateNote({ ...validNote, id: "" });
    expect(errors).toContain("Note ID is required");
  });

  it("catches malformed ID", () => {
    const errors = validateNote({ ...validNote, id: "bad-id" });
    expect(errors[0]).toContain("Invalid note ID format");
  });

  it("catches empty content", () => {
    const errors = validateNote({ ...validNote, content: "   " });
    expect(errors).toContain("Note content must not be empty");
  });

  it("catches missing timestamps", () => {
    const errors = validateNote({
      ...validNote,
      createdAt: "",
      updatedAt: "",
    });
    expect(errors).toContain("createdAt timestamp is required");
    expect(errors).toContain("updatedAt timestamp is required");
  });
});

// ---------------------------------------------------------------------------
// createNote
// ---------------------------------------------------------------------------

describe("createNote", () => {
  it("creates a well-formed note from raw content", () => {
    const note = createNote({ content: "Agents shine when ambiguity exists." }, NOW);
    expect(validateNote(note)).toEqual([]);
    expect(note.content).toBe("Agents shine when ambiguity exists.");
    expect(note.createdAt).toBe("2026-02-22T15:30:45.123Z");
    expect(note.links).toEqual([]);
  });

  it("normalizes content during creation", () => {
    const note = createNote({ content: "  spaced  \n\n\n\nout  " }, NOW);
    expect(note.content).toBe("spaced  \n\nout");
  });

  it("throws on empty content", () => {
    expect(() => createNote({ content: "   " }, NOW)).toThrow(
      "Cannot create a note with empty content",
    );
  });

  it("merges user-provided metadata", () => {
    const note = createNote(
      {
        content: "Test",
        metadata: { title: "My Title", tags: ["philosophy"], source: "book" },
      },
      NOW,
    );
    expect(note.metadata.title).toBe("My Title");
    expect(note.metadata.tags).toEqual(["philosophy"]);
    expect(note.metadata.source).toBe("book");
  });

  it("defaults tags to an empty array", () => {
    const note = createNote({ content: "Test" }, NOW);
    expect(note.metadata.tags).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// serializeNote
// ---------------------------------------------------------------------------

describe("serializeNote", () => {
  it("produces valid markdown with YAML frontmatter", () => {
    const note = createNote(
      {
        content: "An atomic idea.",
        metadata: { title: "Test Note", tags: ["test"] },
      },
      NOW,
    );
    const md = serializeNote(note);
    expect(md).toMatch(/^---\n/);
    expect(md).toContain(`id: ${note.id}`);
    expect(md).toContain('title: "Test Note"');
    expect(md).toContain('tags: ["test"]');
    expect(md).toContain("An atomic idea.");
    expect(md).toMatch(/---\n\nAn atomic idea.\n$/);
  });

  it("omits optional fields when not present", () => {
    const note = createNote({ content: "Minimal" }, NOW);
    const md = serializeNote(note);
    expect(md).not.toContain("title:");
    expect(md).not.toContain("tags:");
    expect(md).not.toContain("source:");
    expect(md).not.toContain("links:");
  });

  it("serializes links when present", () => {
    const note = createNote({ content: "Linked" }, NOW);
    note.links = [{ targetId: "20260101T000000-00000000", similarity: 0.91 }];
    const md = serializeNote(note);
    expect(md).toContain("links:");
    expect(md).toContain("  - target: 20260101T000000-00000000");
    expect(md).toContain("    similarity: 0.91");
  });
});

// ---------------------------------------------------------------------------
// noteFilePath
// ---------------------------------------------------------------------------

describe("noteFilePath", () => {
  it("returns the correct path", () => {
    expect(noteFilePath("20260222T153045-abcd1234", "notes")).toBe(
      "notes/20260222T153045-abcd1234.md",
    );
  });
});
