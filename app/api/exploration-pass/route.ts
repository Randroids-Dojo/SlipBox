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

import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/src/auth";
import { NOTES_DIR } from "@/src/config";
import { parseNoteContent } from "@/src/note";
import { detectExplorations } from "@/src/exploration";
import {
  readEmbeddingsIndex,
  readBacklinksIndex,
  readClustersIndex,
  readRelationsIndex,
  readExplorationsIndex,
  writeExplorationsIndex,
  readNote,
} from "@/src/github";

export async function POST(request: NextRequest) {
  try {
    const auth = verifyAuth(request);
    if (!auth.ok) return auth.response!;

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

    const rawContents = await Promise.all(
      allClusterNoteIds.map((id) => readNote(id, NOTES_DIR)),
    );

    const metaNoteIds = new Set<string>();
    for (let i = 0; i < allClusterNoteIds.length; i++) {
      const raw = rawContents[i];
      if (raw) {
        const parsed = parseNoteContent(raw);
        if (parsed.type === "meta") {
          metaNoteIds.add(allClusterNoteIds[i]);
        }
      }
    }

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
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
