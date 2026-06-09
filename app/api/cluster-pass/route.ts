/**
 * POST /api/cluster-pass
 *
 * Clusters the embedding space into semantic groups and commits clusters.json.
 * The number of clusters is chosen automatically unless overridden by an
 * optional `{ "k": number }` request body.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/src/auth";
import { runClusterPass } from "@/src/passes";

export const POST = withAuth(async (request: NextRequest) => {
  // Optional body: { "k": number }. An empty body is fine (k auto-chosen).
  let k: number | undefined;
  try {
    const body = (await request.json()) as { k?: number };
    k = body.k;
  } catch {
    // No body; k stays undefined.
  }
  return NextResponse.json(await runClusterPass({ k }));
});
