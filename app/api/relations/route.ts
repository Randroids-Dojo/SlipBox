/**
 * POST /api/relations
 *
 * Accepts typed relation records from a local LLM agent and persists them
 * to the relations index (relations.json) in PrivateBox.
 *
 * The typical workflow:
 *   1. GET /api/link-data — fetch unclassified pairs with note content
 *   2. Local LLM classifies each pair
 *   3. POST /api/relations — submit classified records
 *
 * Validation:
 *   - Each record must reference a pair present in the backlinks index.
 *   - Each relationType must be one of the five canonical types.
 *
 * The similarity score is sourced from the backlinks index so the LLM
 * agent does not need to supply it.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/src/auth";
import { readBacklinksIndex, readRelationsIndex, writeRelationsIndex } from "@/src/github";
import { canonicalKey, isValidRelationType, upsertRelation } from "@/src/relation";
import type { RelationType } from "@/types";

/** One incoming relation record from the LLM agent. */
interface RelationInput {
  noteA: string;
  noteB: string;
  relationType: string;
  reason: string;
}

export const POST = withAuth(async (request: NextRequest) => {
  // 1. Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== "object" ||
    !Array.isArray((body as Record<string, unknown>).relations)
  ) {
    return NextResponse.json(
      { error: "Request body must be { relations: [...] }" },
      { status: 400 },
    );
  }

  const inputs = (body as { relations: unknown[] }).relations;

  if (inputs.length === 0) {
    return NextResponse.json(
      { error: "relations array must not be empty" },
      { status: 400 },
    );
  }

  // 2. Validate each record's shape before touching GitHub
  for (let i = 0; i < inputs.length; i++) {
    const item = inputs[i];
    if (!item || typeof item !== "object") {
      return NextResponse.json(
        { error: `relations[${i}] is not an object` },
        { status: 400 },
      );
    }
    const { noteA, noteB, relationType, reason } = item as Record<string, unknown>;
    if (typeof noteA !== "string" || !noteA) {
      return NextResponse.json(
        { error: `relations[${i}].noteA must be a non-empty string` },
        { status: 400 },
      );
    }
    if (typeof noteB !== "string" || !noteB) {
      return NextResponse.json(
        { error: `relations[${i}].noteB must be a non-empty string` },
        { status: 400 },
      );
    }
    if (noteA === noteB) {
      return NextResponse.json(
        { error: `relations[${i}]: noteA and noteB must be different` },
        { status: 400 },
      );
    }
    if (typeof relationType !== "string" || !isValidRelationType(relationType)) {
      return NextResponse.json(
        {
          error: `relations[${i}].relationType "${relationType}" is not a valid relation type`,
        },
        { status: 400 },
      );
    }
    if (typeof reason !== "string" || !reason) {
      return NextResponse.json(
        { error: `relations[${i}].reason must be a non-empty string` },
        { status: 400 },
      );
    }
  }

  const validatedInputs = inputs as RelationInput[];

  // 3. Fetch backlinks and current relations index in parallel
  const [blResult, relResult] = await Promise.all([
    readBacklinksIndex(),
    readRelationsIndex(),
  ]);

  const backlinks = blResult.index;
  const relationsIndex = relResult.index;

  // 4. Build a similarity lookup from the backlinks index (canonical key → similarity)
  const similarityMap = new Map<string, number>();
  for (const [noteId, links] of Object.entries(backlinks.links)) {
    for (const link of links) {
      const key = canonicalKey(noteId, link.targetId);
      if (!similarityMap.has(key)) {
        similarityMap.set(key, link.similarity);
      }
    }
  }

  // 5. Validate that every submitted pair exists in the backlinks index
  for (let i = 0; i < validatedInputs.length; i++) {
    const { noteA, noteB } = validatedInputs[i];
    const key = canonicalKey(noteA, noteB);
    if (!similarityMap.has(key)) {
      return NextResponse.json(
        {
          error: `relations[${i}]: pair (${noteA}, ${noteB}) not found in backlinks index`,
        },
        { status: 400 },
      );
    }
  }

  // 6. Upsert all records into the relations index
  const now = new Date().toISOString();
  for (const { noteA, noteB, relationType, reason } of validatedInputs) {
    const similarity = similarityMap.get(canonicalKey(noteA, noteB))!;
    upsertRelation(
      relationsIndex,
      noteA,
      noteB,
      relationType as RelationType,
      reason,
      similarity,
      now,
    );
  }

  // 7. Commit the updated relations index
  await writeRelationsIndex(
    relationsIndex,
    relResult.sha,
    `Classify ${validatedInputs.length} relations (relations)`,
  );

  const total = Object.keys(relationsIndex.relations).length;

  return NextResponse.json({
    message: "Relations updated",
    updated: validatedInputs.length,
    total,
  });
});
