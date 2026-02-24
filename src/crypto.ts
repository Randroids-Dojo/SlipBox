/**
 * Cryptographic utilities shared across auth modules.
 */

/**
 * Constant-time string comparison.
 *
 * Prevents timing side-channels when comparing secret values.
 * Both strings are compared byte-by-byte; the runtime is
 * determined by the longer string, not by where they diverge.
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
