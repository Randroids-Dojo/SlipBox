/**
 * GET /api/hypothesis-data
 *
 * Returns a structured payload of tension pairs with cluster context for
 * consumption by a local LLM agent. The agent uses this data to generate
 * research hypotheses and submit them back via POST /api/add-note with
 * `type: hypothesis` in the frontmatter.
 *
 * Each tension entry includes:
 * - Full content (title + body) for both tension notes
 * - Content for all sibling notes in the same cluster (broader context)
 *
 * Requires current tensions and clusters indexes (run cluster-pass and tension-pass first).
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/src/auth";
import { NOTES_DIR } from "@/src/config";
import { readTensionsIndex, readClustersIndex, fetchNotesMap } from "@/src/github";

export const GET = withAuth(async () => {
  // 1. Fetch tensions and clusters in parallel
  const [tenResult, clResult] = await Promise.all([
    readTensionsIndex(),
    readClustersIndex(),
  ]);

  const tensions = Object.values(tenResult.index.tensions);
  const clustersMap = clResult.index.clusters;

  if (tensions.length === 0) {
    return NextResponse.json({
      message: "No tensions found. Run tension-pass first.",
      tensions: [],
      tensionCount: 0,
      computedAt: tenResult.index.computedAt,
    });
  }

  // 2. Collect all unique note IDs needed: both tension notes + cluster siblings
  const allNoteIdSet = new Set<string>();
  for (const t of tensions) {
    allNoteIdSet.add(t.noteA);
    allNoteIdSet.add(t.noteB);
    const cluster = clustersMap[t.clusterId];
    if (cluster) {
      for (const id of cluster.noteIds) allNoteIdSet.add(id);
    }
  }

  // 3. Fetch all note contents in parallel
  const notesMap = await fetchNotesMap([...allNoteIdSet], NOTES_DIR);

  // 4. Build the tension payload
  const tensionPayload = tensions.map((t) => {
    const cluster = clustersMap[t.clusterId];
    // Sibling notes: all cluster members except the two tension notes
    const clusterNotes: Record<string, { title?: string; body: string }> = {};
    if (cluster) {
      for (const id of cluster.noteIds) {
        if (id !== t.noteA && id !== t.noteB && notesMap[id]) {
          clusterNotes[id] = notesMap[id];
        }
      }
    }
    return {
      id: t.id,
      noteA: t.noteA,
      noteB: t.noteB,
      similarity: t.similarity,
      clusterId: t.clusterId,
      noteAContent: notesMap[t.noteA] ?? null,
      noteBContent: notesMap[t.noteB] ?? null,
      clusterNotes,
    };
  });

  return NextResponse.json({
    tensions: tensionPayload,
    tensionCount: tensions.length,
    computedAt: tenResult.index.computedAt,
  });
});
