import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createSessionToken,
  verifySessionToken,
  verifySessionAuth,
  timingSafeEqual,
  SESSION_COOKIE,
} from "./session";

describe("SESSION_COOKIE", () => {
  it("is a non-empty string", () => {
    expect(typeof SESSION_COOKIE).toBe("string");
    expect(SESSION_COOKIE.length).toBeGreaterThan(0);
  });
});

describe("createSessionToken", () => {
  it("returns a non-empty hex string", async () => {
    const token = await createSessionToken("my-secret");
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
    expect(/^[0-9a-f]+$/.test(token)).toBe(true);
  });

  it("is deterministic — same secret yields same token", async () => {
    const a = await createSessionToken("secret");
    const b = await createSessionToken("secret");
    expect(a).toBe(b);
  });

  it("produces different tokens for different secrets", async () => {
    const a = await createSessionToken("secret-a");
    const b = await createSessionToken("secret-b");
    expect(a).not.toBe(b);
  });
});

describe("verifySessionToken", () => {
  it("returns true for a valid token", async () => {
    const secret = "my-secret";
    const token = await createSessionToken(secret);
    expect(await verifySessionToken(token, secret)).toBe(true);
  });

  it("returns false for a token created with a different secret", async () => {
    const token = await createSessionToken("secret-a");
    expect(await verifySessionToken(token, "secret-b")).toBe(false);
  });

  it("returns false for a tampered token", async () => {
    const secret = "my-secret";
    const token = await createSessionToken(secret);
    const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    expect(await verifySessionToken(tampered, secret)).toBe(false);
  });

  it("returns false for an empty token", async () => {
    expect(await verifySessionToken("", "my-secret")).toBe(false);
  });

  it("returns false for an empty secret", async () => {
    const token = await createSessionToken("my-secret");
    expect(await verifySessionToken(token, "")).toBe(false);
  });
});

describe("verifySessionAuth", () => {
  const secret = "test-session-secret";

  beforeEach(() => {
    vi.stubEnv("SESSION_SECRET", secret);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function makeRequest(cookieValue?: string): Parameters<typeof verifySessionAuth>[0] {
    const cookies = {
      get: (name: string) =>
        name === SESSION_COOKIE && cookieValue !== undefined
          ? { value: cookieValue }
          : undefined,
    };
    return { cookies } as Parameters<typeof verifySessionAuth>[0];
  }

  it("returns true for a valid session cookie", async () => {
    const token = await createSessionToken(secret);
    expect(await verifySessionAuth(makeRequest(token))).toBe(true);
  });

  it("returns false when no cookie is present", async () => {
    expect(await verifySessionAuth(makeRequest(undefined))).toBe(false);
  });

  it("returns false for a token signed with a different secret", async () => {
    const token = await createSessionToken("wrong-secret");
    expect(await verifySessionAuth(makeRequest(token))).toBe(false);
  });

  it("returns false when SESSION_SECRET is not set", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    const token = await createSessionToken(secret);
    expect(await verifySessionAuth(makeRequest(token))).toBe(false);
  });
});

describe("timingSafeEqual", () => {
  it("returns true for equal strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
  });

  it("returns false for different strings", () => {
    expect(timingSafeEqual("abc", "xyz")).toBe(false);
  });

  it("returns false for strings of different lengths", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });

  it("returns true for empty strings", () => {
    expect(timingSafeEqual("", "")).toBe(true);
  });
});
