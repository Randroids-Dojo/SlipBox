/**
 * POST /api/link-pass
 *
 * Batch recomputation of all similarity links. Fetches all embeddings,
 * recomputes the full similarity matrix, rebuilds backlinks.json, and
 * commits the updated index to PrivateBox.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/src/auth";
import { runLinkPass } from "@/src/passes";

export const POST = withAuth(async () => NextResponse.json(await runLinkPass()));
