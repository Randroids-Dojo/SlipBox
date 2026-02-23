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
import { verifyAuth } from "@/src/auth";
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

export async function POST(request: NextRequest) {
  try {
    const auth = verifyAuth(request);
    if (!auth.ok) return auth.response!;

    const body = (await request.json()) as { content?: string; type?: string };

    if (!body.content || typeof body.content !== "string" || !body.content.trim()) {
      return NextResponse.json(
        { error: "Request body must include a non-empty 'content' string" },
        { status: 400 },
      );
    }

    if (body.type !== undefined && !NOTE_TYPES.includes(body.type as NoteType)) {
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

    // 2. Generate embedding
    const provider = createOpenAIProvider();
    const embedding = await embedNote(note.id, note.content, provider);

    // 3. Fetch embeddings index for the similarity pass
    const embResult = await readEmbeddingsIndex();

    // 4. Similarity pass — find matches above threshold
    const matches = findMatches(
      embedding.vector,
      embResult.index,
      undefined, // use default threshold from config
      new Set([note.id]),
    );
    const links: NoteLink[] = matchesToLinks(matches);

    // 5. Attach links to the note
    note.links = links;

    // 6. Commit note file and backlinks index concurrently.
    //    The note write has no SHA dependency (new file) so it never conflicts.
    //    The backlinks write uses optimistic-concurrency retry for the same
    //    reason as embeddings: concurrent note additions race on the same file.
    const serialized = serializeNote(note);
    const path = noteFilePath(note.id, NOTES_DIR);

    await Promise.all([
      writeFile({
        path,
        content: serialized,
        message: `Add note ${note.id}`,
      }),
      updateJsonFileWithRetry<BacklinksIndex>(
        BACKLINKS_INDEX_PATH,
        emptyBacklinksIndex,
        (idx) => applyMatches(idx, note.id, links),
        `Update backlinks: add ${note.id}`,
      ),
    ]);

    // 7. Update embeddings index with optimistic-concurrency retry.
    //    Separated from step 6 so a conflict here never rolls back the note.
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
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
