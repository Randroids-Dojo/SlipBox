/**
 * POST /api/cluster-pass
 *
 * Clusters the embedding space into semantic groups. Fetches all embeddings
 * from PrivateBox, runs k-means clustering, and commits the resulting
 * clusters index (clusters.json) back to PrivateBox.
 *
 * The number of clusters is chosen automatically based on the number of
 * notes, unless overridden in the request body.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/src/auth";
import { clusterEmbeddings } from "@/src/cluster";
import {
  readEmbeddingsIndex,
  readClustersIndex,
  writeClustersIndex,
} from "@/src/github";
import { MIN_NOTES_FOR_CLUSTERING } from "@/src/config";

export const POST = withAuth(async (request: NextRequest) => {
  // Optional body: { "k": number } to override automatic cluster count
  let requestedK: number | undefined;
  try {
    const body = (await request.json()) as { k?: number };
    if (body.k !== undefined) {
      if (typeof body.k !== "number" || body.k < 2 || !Number.isInteger(body.k)) {
        return NextResponse.json(
          { error: "Optional 'k' must be an integer >= 2" },
          { status: 400 },
        );
      }
      requestedK = body.k;
    }
  } catch {
    // Empty body is fine — k will be chosen automatically
  }

  // 1. Fetch current embeddings and existing clusters
  const [embResult, clResult] = await Promise.all([
    readEmbeddingsIndex(),
    readClustersIndex(),
  ]);

  const noteCount = Object.keys(embResult.index.embeddings).length;

  if (noteCount < MIN_NOTES_FOR_CLUSTERING) {
    return NextResponse.json({
      message: `Not enough notes to cluster (have ${noteCount}, need ${MIN_NOTES_FOR_CLUSTERING})`,
      noteCount,
      clusterCount: 0,
    });
  }

  // 2. Run clustering
  const clustersIndex = clusterEmbeddings(embResult.index, {
    k: requestedK,
  });

  const clusterCount = Object.keys(clustersIndex.clusters).length;

  // 3. Commit updated clusters index
  await writeClustersIndex(
    clustersIndex,
    clResult.sha,
    "Recompute clusters (cluster-pass)",
  );

  // 4. Build summary for response
  const clusterSummary = Object.values(clustersIndex.clusters).map((c) => ({
    id: c.id,
    size: c.noteIds.length,
    noteIds: c.noteIds,
  }));

  return NextResponse.json({
    message: "Cluster pass complete",
    noteCount,
    clusterCount,
    clusters: clusterSummary,
  });
});
