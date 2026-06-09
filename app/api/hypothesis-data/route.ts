/**
 * GET /api/hypothesis-data
 *
 * Returns tension pairs with cluster context for a local LLM agent to generate
 * research hypotheses, submitted back via POST /api/add-note with
 * `type: hypothesis`. Requires current tensions and clusters indexes.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/src/auth";
import { computeHypothesisData } from "@/src/passes";

export const GET = withAuth(async () =>
  NextResponse.json(await computeHypothesisData()),
);
