/**
 * GET /api/link-data
 *
 * Returns deduplicated linked note pairs with full note content and any
 * existing relation classification, for local LLM relation classification.
 *
 * Query: ?unclassifiedOnly=true returns only pairs with no existing relation.
 * Requires a current backlinks index (run link-pass first).
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/src/auth";
import { computeLinkData } from "@/src/passes";

export const GET = withAuth(async (request: NextRequest) => {
  const unclassifiedOnly =
    request.nextUrl.searchParams.get("unclassifiedOnly") === "true";
  return NextResponse.json(await computeLinkData({ unclassifiedOnly }));
});
