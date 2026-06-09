/**
 * POST /api/decay-pass
 *
 * Scores every note for staleness using four pure-math signals: no links, low
 * link density, cluster outlier, and no cluster. Commits decay.json. No LLM
 * calls are made.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/src/auth";
import { runDecayPass } from "@/src/passes";

export const POST = withAuth(async () =>
  NextResponse.json(await runDecayPass()),
);
