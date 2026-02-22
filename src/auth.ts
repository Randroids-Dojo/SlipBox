/**
 * Inbound API authentication.
 *
 * Validates that incoming requests carry a Bearer token matching
 * the SLIPBOX_API_KEY environment variable.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSlipBoxApiKey } from "./config";

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
 * Constant-time string comparison.
 *
 * Prevents timing side-channels when comparing secret values.
 * Both strings are compared byte-by-byte; the runtime is
 * determined by the longer string, not by where they diverge.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);

  // Length mismatch leaks the length, but not the content.
  // We still compare all bytes of the longer string.
  const len = Math.max(bufA.length, bufB.length);
  let mismatch = bufA.length !== bufB.length ? 1 : 0;

  for (let i = 0; i < len; i++) {
    mismatch |= (bufA[i] ?? 0) ^ (bufB[i] ?? 0);
  }

  return mismatch === 0;
}
