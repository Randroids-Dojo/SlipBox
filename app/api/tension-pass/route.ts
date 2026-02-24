/**
 * POST /api/tension-pass
 *
 * Detects semantic tensions — pairs of notes within the same cluster
 * whose embeddings diverge significantly. Fetches embeddings and clusters
 * from PrivateBox, runs tension detection, and commits the resulting
 * tensions index (tensions.json) back to PrivateBox.
 *
 * Requires a current clusters index (run cluster-pass first).
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/src/auth";
import { detectTensions } from "@/src/tension";
import {
  readEmbeddingsIndex,
  readClustersIndex,
  readTensionsIndex,
  writeTensionsIndex,
} from "@/src/github";
import { MIN_NOTES_FOR_TENSION } from "@/src/config";

export const POST = withAuth(async () => {
  // 1. Fetch current embeddings, clusters, and existing tensions
  const [embResult, clResult, tenResult] = await Promise.all([
    readEmbeddingsIndex(),
    readClustersIndex(),
    readTensionsIndex(),
  ]);

  const noteCount = Object.keys(embResult.index.embeddings).length;
  const clusterCount = Object.keys(clResult.index.clusters).length;

  if (noteCount < MIN_NOTES_FOR_TENSION) {
    return NextResponse.json({
      message: `Not enough notes for tension detection (have ${noteCount}, need ${MIN_NOTES_FOR_TENSION})`,
      noteCount,
      tensionCount: 0,
    });
  }

  if (clusterCount === 0) {
    return NextResponse.json(
      { error: "No clusters found. Run cluster-pass first." },
      { status: 400 },
    );
  }

  // 2. Detect tensions
  const tensionsIndex = detectTensions(embResult.index, clResult.index);

  const tensionCount = Object.keys(tensionsIndex.tensions).length;

  // 3. Commit updated tensions index
  await writeTensionsIndex(
    tensionsIndex,
    tenResult.sha,
    "Detect tensions (tension-pass)",
  );

  // 4. Build summary for response
  const tensionSummary = Object.values(tensionsIndex.tensions).map((t) => ({
    id: t.id,
    noteA: t.noteA,
    noteB: t.noteB,
    similarity: t.similarity,
    clusterId: t.clusterId,
  }));

  return NextResponse.json({
    message: "Tension pass complete",
    noteCount,
    clusterCount,
    tensionCount,
    tensions: tensionSummary,
  });
});
