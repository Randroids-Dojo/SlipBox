import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { verifyAuth } from "./auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_API_KEY = "sk-test-secret-key-12345";

function buildRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://example.com/api/add-note", {
    method: "POST",
    headers,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("verifyAuth", () => {
  beforeEach(() => {
    vi.stubEnv("SLIPBOX_API_KEY", TEST_API_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // --- Happy path ---

  it("accepts a valid Bearer token", () => {
    const req = buildRequest({ Authorization: `Bearer ${TEST_API_KEY}` });
    const result = verifyAuth(req);

    expect(result.ok).toBe(true);
    expect(result.response).toBeUndefined();
  });

  // --- Missing header ---

  it("rejects a request with no Authorization header", async () => {
    const req = buildRequest();
    const result = verifyAuth(req);

    expect(result.ok).toBe(false);
    expect(result.response!.status).toBe(401);
    const body = await result.response!.json();
    expect(body.error).toMatch(/Missing Authorization header/);
  });

  // --- Wrong scheme ---

  it("rejects a non-Bearer scheme", async () => {
    const req = buildRequest({ Authorization: `Basic ${TEST_API_KEY}` });
    const result = verifyAuth(req);

    expect(result.ok).toBe(false);
    expect(result.response!.status).toBe(401);
    const body = await result.response!.json();
    expect(body.error).toMatch(/Bearer scheme/);
  });

  // --- Wrong token ---

  it("rejects an invalid token with 403", async () => {
    const req = buildRequest({ Authorization: "Bearer wrong-key" });
    const result = verifyAuth(req);

    expect(result.ok).toBe(false);
    expect(result.response!.status).toBe(403);
    const body = await result.response!.json();
    expect(body.error).toMatch(/Invalid API key/);
  });

  // --- Empty token ---

  it("rejects an empty Bearer value", async () => {
    const req = buildRequest({ Authorization: "Bearer " });
    const result = verifyAuth(req);

    expect(result.ok).toBe(false);
    // NextRequest trims the header, so "Bearer " becomes "Bearer"
    // which fails the scheme check before reaching token comparison.
    expect(result.response!.status).toBe(401);
  });

  // --- Partial match ---

  it("rejects a token that is a prefix of the real key", async () => {
    const req = buildRequest({
      Authorization: `Bearer ${TEST_API_KEY.slice(0, -1)}`,
    });
    const result = verifyAuth(req);

    expect(result.ok).toBe(false);
    expect(result.response!.status).toBe(403);
  });

  it("rejects a token that is the real key plus extra chars", async () => {
    const req = buildRequest({
      Authorization: `Bearer ${TEST_API_KEY}EXTRA`,
    });
    const result = verifyAuth(req);

    expect(result.ok).toBe(false);
    expect(result.response!.status).toBe(403);
  });

  // --- Missing env var ---

  it("throws when SLIPBOX_API_KEY is not set", async () => {
    // Reset modules to clear the lazy cache from prior tests.
    vi.resetModules();
    vi.stubEnv("SLIPBOX_API_KEY", "");

    const { verifyAuth: freshVerifyAuth } = await import("./auth");
    const req = buildRequest({ Authorization: "Bearer anything" });

    expect(() => freshVerifyAuth(req)).toThrow(/SLIPBOX_API_KEY/);
  });
});
