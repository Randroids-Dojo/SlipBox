/**
 * GET /api/graph/data
 *
 * Session-authed read-only data for the browser UI's LLM-loop section. Mirrors
 * the auth model of /api/graph/note (verifySessionAuth) and returns the same
 * payloads as the Bearer *-data and analytics routes.
 *
 * Query: ?kind=theme|link|hypothesis|refinement|analytics
 *        plus pass-through: since, clusterId, unclassifiedOnly
 */

import { type NextRequest, NextResponse } from "next/server";
import { verifySessionAuth } from "@/src/session";
import { mapPassError } from "@/src/http-errors";
import {
  computeThemeData,
  computeLinkData,
  computeHypothesisData,
  computeRefinementData,
  computeAnalytics,
} from "@/src/passes";

const KINDS = ["theme", "link", "hypothesis", "refinement", "analytics"] as const;
type Kind = (typeof KINDS)[number];

export async function GET(req: NextRequest) {
  if (!(await verifySessionAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  const kind = params.get("kind");

  if (!kind || !KINDS.includes(kind as Kind)) {
    return NextResponse.json(
      { error: "Unknown or missing kind" },
      { status: 400 },
    );
  }

  try {
    let result: unknown;
    switch (kind as Kind) {
      case "theme":
        result = await computeThemeData();
        break;
      case "link":
        result = await computeLinkData({
          unclassifiedOnly: params.get("unclassifiedOnly") === "true",
        });
        break;
      case "hypothesis":
        result = await computeHypothesisData();
        break;
      case "refinement":
        result = await computeRefinementData({
          clusterId: params.get("clusterId") ?? undefined,
        });
        break;
      case "analytics":
        result = await computeAnalytics(params.get("since") ?? undefined);
        break;
    }
    return NextResponse.json(result);
  } catch (err) {
    return mapPassError(err);
  }
}
