/**
 * POST /api/refinements
 *
 * Accepts advisory refinement suggestions from a local LLM agent and persists
 * them to index/refinements.json in PrivateBox. Suggestions only: SlipBox never
 * modifies user notes automatically.
 *
 * Input:  { suggestions: [{ noteId, type, suggestion, reason, relatedNoteIds? }] }
 * Output: { updated, total }
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/src/auth";
import { runRefinements } from "@/src/passes";

export const POST = withAuth(async (request: NextRequest) => {
  const body = await request.json();
  return NextResponse.json(await runRefinements(body));
});
