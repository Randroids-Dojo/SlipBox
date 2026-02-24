/**
 * Inbound API authentication.
 *
 * Validates that incoming requests carry a Bearer token matching
 * the SLIPBOX_API_KEY environment variable.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSlipBoxApiKey } from "./config";
import { timingSafeEqual } from "./crypto";

export interface AuthResult {
  ok: boolean;
  response?: NextResponse;
}

/**
 * Verify the Authorization header on an inbound request.
 *
 * Returns `{ ok: true }` when the token matches, or
 * `{ ok: false, response }` with an appropriate error response.
 */
export function verifyAuth(req: NextRequest): AuthResult {
  const header = req.headers.get("authorization");

  if (!header) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Missing Authorization header" },
        { status: 401 },
      ),
    };
  }

  if (!header.startsWith("Bearer ")) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Authorization header must use Bearer scheme" },
        { status: 401 },
      ),
    };
  }

  const token = header.slice("Bearer ".length);
  const expected = getSlipBoxApiKey();

  // Constant-time comparison to prevent timing attacks.
  if (!timingSafeEqual(token, expected)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid API key" }, { status: 403 }),
    };
  }

  return { ok: true };
}

/**
 * Higher-order function that wraps a route handler with:
 * 1. Bearer token authentication (returns 401/403 on failure)
 * 2. Centralized error handling (returns 500 on uncaught errors)
 *
 * Usage:
 *   export const GET = withAuth(async (request) => {
 *     // handler body — no auth check or try/catch needed
 *     return NextResponse.json({ ... });
 *   });
 */
export function withAuth(
  handler: (request: NextRequest) => Promise<NextResponse>,
): (request: NextRequest) => Promise<NextResponse> {
  return async (request) => {
    const auth = verifyAuth(request);
    if (!auth.ok) return auth.response!;
    try {
      return await handler(request);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Internal server error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}
