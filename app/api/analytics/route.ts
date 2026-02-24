/**
 * GET /api/analytics
 *
 * Returns the full snapshots timeline with computed deltas between
 * consecutive snapshots to show the growth trajectory of the knowledge
 * graph over time.
 *
 * Query parameters:
 *   ?since=ISO-DATE  — filter snapshots to those captured on or after this date
 *
 * Response shape:
 *   { snapshots, snapshotCount, since? }
 *
 * Each snapshot in the response includes a `delta` field computed against
 * the previous snapshot in the (filtered or unfiltered) series. The first
 * snapshot always has `delta: null`.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/src/auth";
import { readSnapshotsIndex } from "@/src/github";
import type { GraphSnapshot } from "@/types";

interface SnapshotDelta {
  noteDelta: number;
  linkDelta: number;
  clusterDelta: number;
  tensionDelta: number;
  decayDelta: number;
}

interface SnapshotWithDelta extends GraphSnapshot {
  delta: SnapshotDelta | null;
}

function computeDelta(
  current: GraphSnapshot,
  previous: GraphSnapshot,
): SnapshotDelta {
  return {
    noteDelta: current.noteCount - previous.noteCount,
    linkDelta: current.linkCount - previous.linkCount,
    clusterDelta: current.clusterCount - previous.clusterCount,
    tensionDelta: current.tensionCount - previous.tensionCount,
    decayDelta: current.decayCount - previous.decayCount,
  };
}

export const GET = withAuth(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const sinceParam = searchParams.get("since");

  const { index } = await readSnapshotsIndex();
  let snapshots = index.snapshots;

  if (sinceParam) {
    const sinceDate = new Date(sinceParam);
    snapshots = snapshots.filter(
      (s) => new Date(s.capturedAt) >= sinceDate,
    );
  }

  // Attach deltas: first snapshot gets null, each subsequent gets diff vs previous
  const withDeltas: SnapshotWithDelta[] = snapshots.map((snapshot, i) => {
    const delta =
      i === 0 ? null : computeDelta(snapshot, snapshots[i - 1]);
    return { ...snapshot, delta };
  });

  return NextResponse.json({
    snapshots: withDeltas,
    snapshotCount: withDeltas.length,
    ...(sinceParam && { since: sinceParam }),
  });
});
