/**
 * POST /api/snapshot
 *
 * Captures a point-in-time snapshot of the knowledge graph by reading all
 * five live indexes, computing summary metrics, and appending the result
 * to the snapshots index (index/snapshots.json) in PrivateBox.
 *
 * Intended to be called by a nightly automation run. Each call produces
 * one new GraphSnapshot appended to the SnapshotsIndex.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/src/auth";
import { captureSnapshot } from "@/src/snapshot";
import {
  readEmbeddingsIndex,
  readBacklinksIndex,
  readClustersIndex,
  readTensionsIndex,
  readDecayIndex,
  readSnapshotsIndex,
  writeSnapshotsIndex,
} from "@/src/github";

export const POST = withAuth(async () => {
  // 1. Fetch all five indexes and the existing snapshots index in parallel
  const [embResult, blResult, clResult, tenResult, decResult, snapResult] =
    await Promise.all([
      readEmbeddingsIndex(),
      readBacklinksIndex(),
      readClustersIndex(),
      readTensionsIndex(),
      readDecayIndex(),
      readSnapshotsIndex(),
    ]);

  // 2. Compute the new snapshot
  const snapshot = captureSnapshot(
    embResult.index,
    blResult.index,
    clResult.index,
    tenResult.index,
    decResult.index,
  );

  // 3. Append to snapshots index and persist
  const snapshotsIndex = snapResult.index;
  snapshotsIndex.snapshots.push(snapshot);

  await writeSnapshotsIndex(
    snapshotsIndex,
    snapResult.sha,
    "Capture graph snapshot",
  );

  return NextResponse.json({ snapshot });
});
