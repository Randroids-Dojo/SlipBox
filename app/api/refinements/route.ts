/**
 * POST /api/refinements
 *
 * Accepts advisory refinement suggestions from a local LLM agent and persists
 * them to index/refinements.json in PrivateBox.
 *
 * Suggestions only — SlipBox never modifies user notes automatically.
 *
 * Input:
 *   { "suggestions": [{ "noteId", "type", "suggestion", "reason", "relatedNoteIds"? }] }
 *
 * Output:
 *   { "updated": number, "total": number }
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/src/auth";
import { REFINEMENT_TYPES, type RefinementType } from "@/types";
import { readRefinementsIndex, writeRefinementsIndex } from "@/src/github";

interface SuggestionInput {
  noteId: string;
  type: string;
  suggestion: string;
  reason: string;
  relatedNoteIds?: string[];
}

export const POST = withAuth(async (request: NextRequest) => {
  const body = (await request.json()) as { suggestions?: unknown };
  if (!Array.isArray(body.suggestions) || body.suggestions.length === 0) {
    return NextResponse.json(
      { error: "Request body must include a non-empty suggestions array." },
      { status: 400 },
    );
  }

  const inputs = body.suggestions as SuggestionInput[];

  // Validate all entries before writing anything
  for (const s of inputs) {
    if (!s || typeof s !== "object") {
      return NextResponse.json(
        { error: "Each suggestion must be an object." },
        { status: 400 },
      );
    }
    if (!s.noteId || typeof s.noteId !== "string") {
      return NextResponse.json(
        { error: "Each suggestion must have a noteId string." },
        { status: 400 },
      );
    }
    if (!(REFINEMENT_TYPES as readonly string[]).includes(s.type)) {
      return NextResponse.json(
        { error: `Invalid refinement type: "${s.type}". Must be one of: ${REFINEMENT_TYPES.join(", ")}.` },
        { status: 400 },
      );
    }
    if (!s.suggestion || typeof s.suggestion !== "string") {
      return NextResponse.json(
        { error: "Each suggestion must have a suggestion string." },
        { status: 400 },
      );
    }
    if (!s.reason || typeof s.reason !== "string") {
      return NextResponse.json(
        { error: "Each suggestion must have a reason string." },
        { status: 400 },
      );
    }
  }

  const refResult = await readRefinementsIndex();
  const index = refResult.index;
  const now = new Date().toISOString();

  for (const s of inputs) {
    const key = `${s.noteId}:${s.type}`;
    index.suggestions[key] = {
      id: key,
      noteId: s.noteId,
      type: s.type as RefinementType,
      suggestion: s.suggestion,
      reason: s.reason,
      relatedNoteIds: Array.isArray(s.relatedNoteIds) ? s.relatedNoteIds : [],
      generatedAt: now,
    };
  }

  index.updatedAt = now;
  const total = Object.keys(index.suggestions).length;

  await writeRefinementsIndex(index, refResult.sha, "Update refinement suggestions");

  return NextResponse.json({ updated: inputs.length, total });
});
