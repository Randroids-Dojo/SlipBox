/**
 * POST /api/relations
 *
 * Accepts typed relation records from a local LLM agent and persists them to
 * relations.json in PrivateBox. Each record must reference a pair present in
 * the backlinks index and use one of the canonical relation types; the
 * similarity score is sourced from the backlinks index.
 *
 * Input: { relations: [{ noteA, noteB, relationType, reason }] }
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/src/auth";
import { runRelations, PassValidationError } from "@/src/passes";

export const POST = withAuth(async (request: NextRequest) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new PassValidationError("Invalid JSON body");
  }
  return NextResponse.json(await runRelations(body));
});
