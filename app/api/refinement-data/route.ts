/**
 * GET /api/refinement-data
 *
 * Returns clusters with full note content and decay records for consumption
 * by a local LLM agent. The agent uses this data to generate advisory
 * refinement suggestions (retitle, split, merge-suggest, update) and submits
 * them back via POST /api/refinements.
 *
 * Suggestions only — SlipBox never modifies user notes automatically.
 *
 * Query parameters:
 *   ?clusterId=X  — restrict response to a single cluster
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/src/auth";
import { NOTES_DIR } from "@/src/config";
import { readClustersIndex, readDecayIndex, fetchNotesMap } from "@/src/github";

export const GET = withAuth(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const filterClusterId = searchParams.get("clusterId");

  // 1. Fetch clusters and decay in parallel
  const [clResult, decResult] = await Promise.all([
    readClustersIndex(),
    readDecayIndex(),
  ]);

  const allClusters = Object.values(clResult.index.clusters);
  const clusters = filterClusterId
    ? allClusters.filter((c) => c.id === filterClusterId)
    : allClusters;

  if (clusters.length === 0) {
    return NextResponse.json({
      message:
        filterClusterId
          ? `Cluster "${filterClusterId}" not found.`
          : "No clusters found. Run cluster-pass first.",
      clusters: [],
      clusterCount: 0,
      noteCount: 0,
      computedAt: clResult.index.computedAt,
    });
  }

  // 2. Collect all unique note IDs across selected clusters and fetch content
  const allNoteIdSet = new Set<string>();
  for (const cluster of clusters) {
    for (const id of cluster.noteIds) allNoteIdSet.add(id);
  }
  const noteIdList = [...allNoteIdSet];
  const notesMap = await fetchNotesMap(noteIdList, NOTES_DIR);

  const decayRecords = decResult.index.records;

  // 3. Build cluster payload
  const clusterPayload = clusters.map((cluster) => {
    const notes: Record<
      string,
      { title?: string; body: string; decay?: { score: number; reasons: string[] } }
    > = {};
    for (const id of cluster.noteIds) {
      if (notesMap[id]) {
        const decay = decayRecords[id];
        notes[id] = {
          ...notesMap[id],
          ...(decay ? { decay: { score: decay.score, reasons: decay.reasons } } : {}),
        };
      }
    }
    return {
      id: cluster.id,
      memberCount: cluster.noteIds.length,
      notes,
    };
  });

  return NextResponse.json({
    clusters: clusterPayload,
    clusterCount: clusters.length,
    noteCount: noteIdList.length,
    computedAt: clResult.index.computedAt,
  });
});
