/**
 * POST /api/add-note
 *
 * Full pipeline: create note → embed → fetch index → similarity pass →
 * update links → commit all changes to PrivateBox.
 *
 * Input:  { "content": "..." }
 * Output: { "noteId": "...", "linkedNotes": [...] }
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/src/auth";
import { NOTES_DIR } from "@/src/config";
import { createNote, serializeNote, noteFilePath } from "@/src/note";
import { createOpenAIProvider, embedNote } from "@/src/embeddings";
import { findMatches, matchesToLinks } from "@/src/similarity";
import { applyMatches } from "@/src/graph";
import {
  readEmbeddingsIndex,
  writeEmbeddingsIndex,
  readBacklinksIndex,
  writeBacklinksIndex,
  writeFile,
} from "@/src/github";
import type { NoteLink } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const auth = verifyAuth(request);
    if (!auth.ok) return auth.response!;

    const body = (await request.json()) as { content?: string };

    if (!body.content || typeof body.content !== "string" || !body.content.trim()) {
      return NextResponse.json(
        { error: "Request body must include a non-empty 'content' string" },
        { status: 400 },
      );
    }

    // 1. Create note
    const note = createNote({ content: body.content });

    // 2. Generate embedding
    const provider = createOpenAIProvider();
    const embedding = await embedNote(note.id, note.content, provider);

    // 3. Fetch current indexes from PrivateBox
    const [embResult, blResult] = await Promise.all([
      readEmbeddingsIndex(),
      readBacklinksIndex(),
    ]);

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

    // 6. Update embeddings index
    embResult.index.embeddings[note.id] = embedding;

    // 7. Update backlinks index
    applyMatches(blResult.index, note.id, links);

    // 8. Commit all changes to PrivateBox
    const serialized = serializeNote(note);
    const path = noteFilePath(note.id, NOTES_DIR);

    await Promise.all([
      writeFile({
        path,
        content: serialized,
        message: `Add note ${note.id}`,
      }),
      writeEmbeddingsIndex(
        embResult.index,
        embResult.sha,
        `Update embeddings: add ${note.id}`,
      ),
      writeBacklinksIndex(
        blResult.index,
        blResult.sha,
        `Update backlinks: add ${note.id}`,
      ),
    ]);

    return NextResponse.json({
      noteId: note.id,
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
