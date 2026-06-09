/**
 * GET /api/health
 *
 * Liveness probe - returns HTTP 200 when the service is running.
 * No authentication required.
 */

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ status: "ok" });
}
