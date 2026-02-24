/**
 * GET /api/link-data
 *
 * Returns linked note pairs with full note content for local LLM relation
 * classification. The LLM classifies each pair and submits results back via
 * POST /api/relations.
 *
 * Pairs are derived from the backlinks index. Bidirectional links are
 * deduplicated so each pair appears exactly once. Each pair includes:
 * - noteA / noteB IDs (canonical order: smaller ID first)
 * - cosine similarity score from the backlinks index
 * - note content (title + body) for both notes
 * - existing relation classification if the pair has already been typed
 *
 * Query params:
 *   ?unclassifiedOnly=true  — return only pairs with no existing relation
 *                             type, for incremental classification runs
 *
 * Requires a current backlinks index (run link-pass first).
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/src/auth";
import { NOTES_DIR } from "@/src/config";
import { readBacklinksIndex, readRelationsIndex, fetchNotesMap } from "@/src/github";
import { canonicalKey } from "@/src/relation";

export const GET = withAuth(async (request: NextRequest) => {
  const unclassifiedOnly =
    request.nextUrl.searchParams.get("unclassifiedOnly") === "true";

  // 1. Fetch backlinks and relations in parallel
  const [blResult, relResult] = await Promise.all([
    readBacklinksIndex(),
    readRelationsIndex(),
  ]);

  const backlinks = blResult.index;
  const relations = relResult.index;

  // 2. Build unique pairs from backlinks (deduplicate bidirectional entries)
  const seenKeys = new Set<string>();
  const allPairs: Array<{ noteA: string; noteB: string; similarity: number }> =
    [];

  for (const [noteId, links] of Object.entries(backlinks.links)) {
    for (const link of links) {
      const key = canonicalKey(noteId, link.targetId);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        const [a, b] =
          noteId < link.targetId
            ? [noteId, link.targetId]
            : [link.targetId, noteId];
        allPairs.push({ noteA: a, noteB: b, similarity: link.similarity });
      }
    }
  }

  // 3. Count classified pairs across the full unfiltered set
  const classifiedCount = allPairs.filter(
    (p) => !!relations.relations[canonicalKey(p.noteA, p.noteB)],
  ).length;

  // 4. Apply unclassifiedOnly filter
  const filteredPairs = unclassifiedOnly
    ? allPairs.filter(
        (p) => !relations.relations[canonicalKey(p.noteA, p.noteB)],
      )
    : allPairs;

  // 5. Collect unique note IDs across filtered pairs and fetch content
  const allNoteIds = [
    ...new Set(filteredPairs.flatMap((p) => [p.noteA, p.noteB])),
  ];

  const notesMap = await fetchNotesMap(allNoteIds, NOTES_DIR);

  // 6. Build response pairs
  const pairs = filteredPairs.map((p) => {
    const key = canonicalKey(p.noteA, p.noteB);
    return {
      noteA: p.noteA,
      noteB: p.noteB,
      similarity: p.similarity,
      noteAContent: notesMap[p.noteA] ?? null,
      noteBContent: notesMap[p.noteB] ?? null,
      relation: relations.relations[key] ?? null,
    };
  });

  return NextResponse.json({
    pairs,
    pairCount: pairs.length,
    classifiedCount,
    computedAt: new Date().toISOString(),
  });
});
