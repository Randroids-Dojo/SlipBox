/**
 * POST /api/link-pass
 *
 * Batch recomputation of all similarity links. Fetches all embeddings,
 * recomputes the full similarity matrix, rebuilds backlinks.json, and
 * commits the updated index to PrivateBox.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/src/auth";
import { findMatches } from "@/src/similarity";
import { rebuildBacklinks } from "@/src/graph";
import {
  readEmbeddingsIndex,
  readBacklinksIndex,
  writeBacklinksIndex,
} from "@/src/github";

export async function POST(request: NextRequest) {
  try {
    const auth = verifyAuth(request);
    if (!auth.ok) return auth.response!;

    // 1. Fetch current embeddings and backlinks indexes
    const [embResult, blResult] = await Promise.all([
      readEmbeddingsIndex(),
      readBacklinksIndex(),
    ]);

    const noteIds = Object.keys(embResult.index.embeddings);

    if (noteIds.length === 0) {
      return NextResponse.json({
        message: "No notes to link",
        totalLinks: 0,
      });
    }

    // 2. Compute full similarity matrix
    const linkPairs: { noteA: string; noteB: string; similarity: number }[] = [];
    const seen = new Set<string>();

    for (const noteId of noteIds) {
      const embedding = embResult.index.embeddings[noteId];
      const matches = findMatches(
        embedding.vector,
        embResult.index,
        undefined, // use default threshold
        new Set([noteId]),
      );

      for (const match of matches) {
        // Avoid duplicate pairs (A-B and B-A)
        const pairKey =
          noteId < match.noteId
            ? `${noteId}:${match.noteId}`
            : `${match.noteId}:${noteId}`;

        if (!seen.has(pairKey)) {
          seen.add(pairKey);
          linkPairs.push({
            noteA: noteId,
            noteB: match.noteId,
            similarity: match.similarity,
          });
        }
      }
    }

    // 3. Rebuild backlinks from scratch
    const newBacklinks = rebuildBacklinks(linkPairs);

    // 4. Commit updated backlinks index
    await writeBacklinksIndex(
      newBacklinks,
      blResult.sha,
      "Recompute all backlinks (link-pass)",
    );

    return NextResponse.json({
      message: "Link pass complete",
      notesProcessed: noteIds.length,
      totalLinks: linkPairs.length,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
