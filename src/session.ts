/**
 * Browser session token management.
 *
 * Also provides a session-cookie auth helper for API routes that serve
 * browser clients (e.g. /api/graph/*) instead of machine callers.
 *
 * Uses HMAC-SHA-256 (Web Crypto API) to produce and verify stateless session
 * tokens. No database or server-side state required.
 *
 * Compatible with both the Node.js and Edge runtimes.
 */

import type { NextRequest } from "next/server";

export const SESSION_COOKIE = "slipbox_session";

const SESSION_PAYLOAD = "slipbox-authenticated";

/**
 * Produce a session token signed with the given secret.
 * The token is deterministic: same secret always yields the same token.
 */
export async function createSessionToken(secret: string): Promise<string> {
  return hmacSha256(secret, SESSION_PAYLOAD);
}

/**
 * Verify a session token against the given secret.
 * Uses constant-time comparison to prevent timing attacks.
 */
export async function verifySessionToken(
  token: string,
  secret: string,
): Promise<boolean> {
  if (!secret || !token) return false;
  const expected = await hmacSha256(secret, SESSION_PAYLOAD);
  return timingSafeEqual(token, expected);
}

async function hmacSha256(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message),
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify the session cookie on an inbound browser request.
 * Used by API routes that serve the graph UI instead of machine callers.
 */
export async function verifySessionAuth(req: NextRequest): Promise<boolean> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  return verifySessionToken(token, secret);
}

/**
 * Constant-time string comparison.
 * Prevents timing side-channels when comparing secret values.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  const len = Math.max(bufA.length, bufB.length);
  let mismatch = bufA.length !== bufB.length ? 1 : 0;
  for (let i = 0; i < len; i++) {
    mismatch |= (bufA[i] ?? 0) ^ (bufB[i] ?? 0);
  }
  return mismatch === 0;
}
