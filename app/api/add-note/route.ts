/**
 * POST /api/add-note
 *
 * Full pipeline: create note → embed → fetch index → similarity pass →
 * update links → commit all changes to PrivateBox.
 *
 * Input:  { "content": "...", "type": "meta" | "hypothesis" (optional) }
 * Output: { "noteId": "...", "type": "meta" | "hypothesis" | null, "linkedNotes": [...] }
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/src/auth";
import { BACKLINKS_INDEX_PATH, NOTES_DIR } from "@/src/config";
import { createNote, serializeNote, noteFilePath } from "@/src/note";
import { createOpenAIProvider, embedNote } from "@/src/embeddings";
import { findMatches, matchesToLinks } from "@/src/similarity";
import { applyMatches } from "@/src/graph";
import {
  readEmbeddingsIndex,
  updateJsonFileWithRetry,
  upsertEmbeddingWithRetry,
  writeFile,
} from "@/src/github";
import { type BacklinksIndex, type NoteLink, type NoteType, NOTE_TYPES, emptyBacklinksIndex } from "@/types";

export const POST = withAuth(async (request: NextRequest) => {
  const body = (await request.json()) as { content?: string; type?: string };

  if (!body.content || typeof body.content !== "string" || !body.content.trim()) {
    return NextResponse.json(
      { error: "Request body must include a non-empty 'content' string" },
      { status: 400 },
    );
  }

  if (body.type !== undefined && !(NOTE_TYPES as readonly string[]).includes(body.type)) {
    return NextResponse.json(
      { error: `Invalid note type. Must be one of: ${NOTE_TYPES.join(", ")}` },
      { status: 400 },
    );
  }

  const noteType = body.type as NoteType | undefined;

  // 1. Create note
  const note = createNote({
    content: body.content,
    metadata: noteType ? { type: noteType } : undefined,
  });

  // 2. Embed the new note and fetch the embeddings index in parallel.
  //    Both are reads with no mutation, so there is no commit-race risk.
  const provider = createOpenAIProvider();
  const [embedding, embResult] = await Promise.all([
    embedNote(note.id, note.content, provider),
    readEmbeddingsIndex(),
  ]);

  // 3. Similarity pass: find matches above threshold and attach as links.
  const matches = findMatches(
    embedding.vector,
    embResult.index,
    undefined,
    new Set([note.id]),
  );
  const links: NoteLink[] = matchesToLinks(matches);
  note.links = links;

  // 4. Serialize commits to one branch. GitHub returns 409 to the loser of any
  //    concurrent commits, and writeFile has no retry, so parallelism here
  //    occasionally surfaced GitHubConflictError on the note write. Cross-
  //    request races on the shared index files are still handled by
  //    updateJsonFileWithRetry.
  const serialized = serializeNote(note);
  const path = noteFilePath(note.id, NOTES_DIR);

  await writeFile({
    path,
    content: serialized,
    message: `Add note ${note.id}`,
  });

  await updateJsonFileWithRetry<BacklinksIndex>(
    BACKLINKS_INDEX_PATH,
    emptyBacklinksIndex,
    (idx) => applyMatches(idx, note.id, links),
    `Update backlinks: add ${note.id}`,
  );

  await upsertEmbeddingWithRetry(
    note.id,
    embedding,
    `Update embeddings: add ${note.id}`,
  );

  return NextResponse.json({
    noteId: note.id,
    type: note.metadata.type ?? null,
    linkedNotes: links.map((l) => ({
      noteId: l.targetId,
      similarity: l.similarity,
    })),
  });
});
