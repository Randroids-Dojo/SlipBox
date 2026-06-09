/**
 * GET /api/refinement-data
 *
 * Returns clusters with full note content and decay records for a local LLM
 * agent to generate advisory refinement suggestions, submitted back via POST
 * /api/refinements. Suggestions only: SlipBox never modifies notes.
 *
 * Query: ?clusterId=X restricts the response to a single cluster.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/src/auth";
import { computeRefinementData } from "@/src/passes";

export const GET = withAuth(async (request: NextRequest) => {
  const clusterId =
    new URL(request.url).searchParams.get("clusterId") ?? undefined;
  return NextResponse.json(await computeRefinementData({ clusterId }));
});
