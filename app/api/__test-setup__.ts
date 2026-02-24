/**
 * Shared test utilities for API route tests.
 *
 * Provides environment setup, fetch spy registration, and GitHub API
 * response factories used across all API route test suites.
 */

import { beforeEach, afterEach, vi } from "vitest";

/** The test API key used across all route tests. */
export const TEST_API_KEY = "sk-test-slipbox-key";

/**
 * Register beforeEach/afterEach hooks to set and clear environment variables
 * required by API route tests.
 *
 * Always sets SLIPBOX_API_KEY, GITHUB_TOKEN, PRIVATEBOX_OWNER, and
 * PRIVATEBOX_REPO. Pass additional variables in `extra` when a test suite
 * also requires them (e.g. OPENAI_API_KEY for add-note tests).
 */
export function setupTestEnv(extra: Record<string, string> = {}): void {
  const envVars: Record<string, string> = {
    SLIPBOX_API_KEY: TEST_API_KEY,
    GITHUB_TOKEN: "ghp_test_token",
    PRIVATEBOX_OWNER: "test-owner",
    PRIVATEBOX_REPO: "test-repo",
    ...extra,
  };

  beforeEach(() => {
    for (const [key, value] of Object.entries(envVars)) {
      process.env[key] = value;
    }
  });

  afterEach(() => {
    for (const key of Object.keys(envVars)) {
      delete process.env[key];
    }
  });
}

/**
 * Register beforeEach/afterEach hooks for the global fetch spy.
 *
 * Returns a container whose `.spy` property holds the active spy during each
 * test. Access it as `fetchSpy.spy.mockResolvedValueOnce(...)`.
 *
 * Note: the `.spy` property must be accessed at call time (inside the test
 * body), not at setup time, because it is reassigned before each test.
 */
export function setupFetchSpy(): { spy: ReturnType<typeof vi.spyOn> } {
  const ref = { spy: null as unknown as ReturnType<typeof vi.spyOn> };

  beforeEach(() => {
    ref.spy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    ref.spy.mockRestore();
  });

  return ref;
}

/** Fake response for a GitHub 404 (file not found). */
export function fakeGitHub404(): Response {
  return {
    ok: false,
    status: 404,
    json: async () => ({ message: "Not Found" }),
    text: async () => "Not Found",
  } as unknown as Response;
}

/**
 * Fake response for a GitHub file read (GET /contents).
 * Encodes content as base64, matching the real API response.
 */
export function fakeGitHubContents(
  content: string,
  sha: string = "sha123",
): Response {
  const encoded = Buffer.from(content, "utf-8").toString("base64");
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: encoded, sha, encoding: "base64" }),
    text: async () => "",
  } as unknown as Response;
}

/** Fake response for a successful GitHub file write (PUT /contents). */
export function fakeGitHubPut(sha: string = "newsha"): Response {
  return {
    ok: true,
    status: 201,
    json: async () => ({ content: { sha } }),
    text: async () => "",
  } as unknown as Response;
}
