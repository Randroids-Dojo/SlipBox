/**
 * GET /api/theme-data
 *
 * Returns a structured payload of clusters, note contents, and tensions
 * for consumption by a local LLM agent. The agent uses this data to
 * synthesize meta-notes (one per cluster) and submit them back via
 * POST /api/add-note.
 *
 * Note contents include the optional title and markdown body extracted
 * from each note's serialized frontmatter. No embeddings are returned —
 * only the human-readable content the agent needs to reason over.
 *
 * Requires a current clusters index (run cluster-pass first).
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/src/auth";
import { NOTES_DIR } from "@/src/config";
import { parseNoteContent } from "@/src/note";
import { readClustersIndex, readTensionsIndex, readNote } from "@/src/github";

export async function GET(request: NextRequest) {
  try {
    const auth = verifyAuth(request);
    if (!auth.ok) return auth.response!;

    // 1. Fetch clusters and tensions in parallel
    const [clResult, tenResult] = await Promise.all([
      readClustersIndex(),
      readTensionsIndex(),
    ]);

    const clusters = Object.values(clResult.index.clusters);
    const tensions = Object.values(tenResult.index.tensions);

    if (clusters.length === 0) {
      return NextResponse.json({
        message: "No clusters found. Run cluster-pass first.",
        clusters: [],
        tensions: [],
        clusterCount: 0,
        noteCount: 0,
        tensionCount: 0,
      });
    }

    // 2. Collect unique note IDs across all clusters
    const allNoteIds = [...new Set(clusters.flatMap((c) => c.noteIds))];

    // 3. Fetch all note contents in parallel
    const rawContents = await Promise.all(
      allNoteIds.map((id) => readNote(id, NOTES_DIR)),
    );

    // 4. Build a note content map: noteId → { title?, body }
    const notesMap: Record<string, { title?: string; body: string }> = {};
    for (let i = 0; i < allNoteIds.length; i++) {
      const raw = rawContents[i];
      if (raw) {
        notesMap[allNoteIds[i]] = parseNoteContent(raw);
      }
    }

    // 5. Shape the cluster payload — attach note content to each cluster
    const clusterPayload = clusters.map((c) => ({
      id: c.id,
      noteIds: c.noteIds,
      notes: Object.fromEntries(
        c.noteIds
          .filter((id) => notesMap[id])
          .map((id) => [id, notesMap[id]]),
      ),
    }));

    return NextResponse.json({
      clusters: clusterPayload,
      tensions: tensions.map((t) => ({
        id: t.id,
        noteA: t.noteA,
        noteB: t.noteB,
        similarity: t.similarity,
        clusterId: t.clusterId,
      })),
      clusterCount: clusters.length,
      noteCount: allNoteIds.length,
      tensionCount: tensions.length,
      computedAt: clResult.index.computedAt,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
