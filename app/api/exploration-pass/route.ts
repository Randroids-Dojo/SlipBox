/**
 * POST /api/exploration-pass
 *
 * Detects structural gaps in the knowledge graph (orphan notes, close cluster
 * pairs, structural holes, clusters missing a meta-note) and commits
 * explorations.json. No LLM calls are made.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/src/auth";
import { runExplorationPass } from "@/src/passes";

export const POST = withAuth(async () =>
  NextResponse.json(await runExplorationPass()),
);
