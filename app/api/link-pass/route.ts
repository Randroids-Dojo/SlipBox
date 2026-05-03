/**
 * POST /api/link-pass
 *
 * Batch recomputation of all similarity links. Fetches all embeddings,
 * recomputes the full similarity matrix, rebuilds backlinks.json, and
 * commits the updated index to PrivateBox.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/src/auth";
import { cosineSimilarity } from "@/src/similarity";
import { rebuildBacklinks } from "@/src/graph";
import { SIMILARITY_THRESHOLD } from "@/src/config";
import {
  readEmbeddingsIndex,
  readBacklinksIndex,
  writeBacklinksIndex,
} from "@/src/github";

export const POST = withAuth(async () => {
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

  // 2. Compute the upper-triangle of the similarity matrix.
  //    Each pair's dot product is computed once instead of twice, halving the
  //    work versus calling findMatches per note.
  const linkPairs: { noteA: string; noteB: string; similarity: number }[] = [];

  for (let i = 0; i < noteIds.length; i++) {
    const a = embResult.index.embeddings[noteIds[i]];
    for (let j = i + 1; j < noteIds.length; j++) {
      const b = embResult.index.embeddings[noteIds[j]];
      const similarity = cosineSimilarity(a.vector, b.vector);
      if (similarity >= SIMILARITY_THRESHOLD) {
        linkPairs.push({
          noteA: noteIds[i],
          noteB: noteIds[j],
          similarity,
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
});
