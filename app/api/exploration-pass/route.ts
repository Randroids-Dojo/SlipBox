/**
 * POST /api/exploration-pass
 *
 * Detects structural gaps in the knowledge graph using four pure-math
 * signals: orphan notes, close cluster pairs, structural holes, and
 * clusters missing a meta-note. Fetches all required indexes from
 * PrivateBox, runs detection, and commits the resulting explorations
 * index (explorations.json) back to PrivateBox.
 *
 * No LLM calls are made.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/src/auth";
import { NOTES_DIR } from "@/src/config";
import { detectExplorations } from "@/src/exploration";
import {
  readEmbeddingsIndex,
  readBacklinksIndex,
  readClustersIndex,
  readRelationsIndex,
  readExplorationsIndex,
  writeExplorationsIndex,
  fetchNotesMap,
} from "@/src/github";

export const POST = withAuth(async () => {
  // 1. Fetch all required indexes in parallel
  const [embResult, blResult, clResult, relResult, expResult] =
    await Promise.all([
      readEmbeddingsIndex(),
      readBacklinksIndex(),
      readClustersIndex(),
      readRelationsIndex(),
      readExplorationsIndex(),
    ]);

  // 2. Collect all unique note IDs across clusters and fetch their content
  //    to determine which notes have `type: meta`
  const allClusterNoteIds = [
    ...new Set(
      Object.values(clResult.index.clusters).flatMap((c) => c.noteIds),
    ),
  ];

  const notesMap = await fetchNotesMap(allClusterNoteIds, NOTES_DIR);

  const metaNoteIds = new Set<string>(
    Object.entries(notesMap)
      .filter(([, parsed]) => parsed.type === "meta")
      .map(([id]) => id),
  );

  // 3. Run exploration detection
  const explorationsIndex = detectExplorations(
    embResult.index,
    blResult.index,
    clResult.index,
    relResult.index,
    { metaNoteIds },
  );

  const suggestionCount = explorationsIndex.suggestions.length;

  // 4. Commit updated explorations index
  await writeExplorationsIndex(
    explorationsIndex,
    expResult.sha,
    "Detect structural gaps (exploration-pass)",
  );

  // 5. Shape summary by type
  const byType = explorationsIndex.suggestions.reduce<Record<string, number>>(
    (acc, s) => {
      acc[s.type] = (acc[s.type] ?? 0) + 1;
      return acc;
    },
    {},
  );

  return NextResponse.json({
    message: "Exploration pass complete",
    suggestionCount,
    byType,
    suggestions: explorationsIndex.suggestions,
  });
});
