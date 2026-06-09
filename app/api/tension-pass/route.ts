/**
 * POST /api/tension-pass
 *
 * Detects semantic tensions: pairs of notes within the same cluster whose
 * embeddings diverge. Commits tensions.json. Requires a current clusters index
 * (run cluster-pass first), otherwise returns 400.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/src/auth";
import { runTensionPass } from "@/src/passes";

export const POST = withAuth(async () =>
  NextResponse.json(await runTensionPass()),
);
