/**
 * GET /api/analytics
 *
 * Returns the full snapshots timeline with computed deltas between consecutive
 * snapshots. Supports `?since=ISO-DATE` to filter. The first snapshot in the
 * series always has `delta: null`.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/src/auth";
import { computeAnalytics } from "@/src/passes";

export const GET = withAuth(async (request: NextRequest) => {
  const since = new URL(request.url).searchParams.get("since") ?? undefined;
  return NextResponse.json(await computeAnalytics(since));
});
