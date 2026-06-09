/**
 * POST /api/snapshot
 *
 * Captures a point-in-time snapshot of the knowledge graph by reading all five
 * live indexes, computing summary metrics, and appending the result to
 * index/snapshots.json in PrivateBox.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/src/auth";
import { runSnapshot } from "@/src/passes";

export const POST = withAuth(async () => NextResponse.json(await runSnapshot()));
