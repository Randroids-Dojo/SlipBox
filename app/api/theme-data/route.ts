/**
 * GET /api/theme-data
 *
 * Returns clusters, note contents, and tensions for a local LLM agent to
 * synthesize meta-notes (one per cluster), submitted back via POST
 * /api/add-note. No embeddings are returned, only human-readable content.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/src/auth";
import { computeThemeData } from "@/src/passes";

export const GET = withAuth(async () =>
  NextResponse.json(await computeThemeData()),
);
