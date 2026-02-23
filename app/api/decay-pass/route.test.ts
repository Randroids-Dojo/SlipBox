import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

// ---------------------------------------------------------------------------
// Environment setup
// ---------------------------------------------------------------------------

const TEST_API_KEY = "sk-test-slipbox-key";

beforeEach(() => {
  process.env.SLIPBOX_API_KEY = TEST_API_KEY;
  process.env.GITHUB_TOKEN = "ghp_test_token";
  process.env.PRIVATEBOX_OWNER = "test-owner";
  process.env.PRIVATEBOX_REPO = "test-repo";
});

afterEach(() => {
  delete process.env.SLIPBOX_API_KEY;
  delete process.env.GITHUB_TOKEN;
  delete process.env.PRIVATEBOX_OWNER;
  delete process.env.PRIVATEBOX_REPO;
});

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

function fakeGitHub404() {
  return {
    ok: false,
    status: 404,
    json: async () => ({ message: "Not Found" }),
    text: async () => "Not Found",
  } as unknown as Response;
}

function fakeGitHubContents(content: string, sha: string = "sha123") {
  const encoded = Buffer.from(content, "utf-8").toString("base64");
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: encoded, sha, encoding: "base64" }),
    text: async () => "",
  } as unknown as Response;
}

function fakeGitHubPut(sha: string = "newsha") {
  return {
    ok: true,
    status: 201,
    json: async () => ({ content: { sha } }),
    text: async () => "",
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/decay-pass", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TEST_API_KEY}`,
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/decay-pass", () => {
  it("returns zero stale notes when embeddings index is empty", async () => {
    fetchSpy
      // Read embeddings.json → 404
      .mockResolvedValueOnce(fakeGitHub404())
      // Read backlinks.json → 404
      .mockResolvedValueOnce(fakeGitHub404())
      // Read clusters.json → 404
      .mockResolvedValueOnce(fakeGitHub404())
      // Read decay.json → 404
      .mockResolvedValueOnce(fakeGitHub404())
      // Write decay.json
      .mockResolvedValueOnce(fakeGitHubPut("decay-sha"));

    const response = await POST(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.message).toBe("Decay pass complete");
    expect(json.noteCount).toBe(0);
    expect(json.staleCount).toBe(0);
    expect(json.records).toEqual([]);
  });

  it("detects stale notes and commits decay index", async () => {
    // note-a: zero links → no-links + low-link-density; no-cluster → score 0.7 (stale)
    // note-b: 3 links and in cluster with close centroid → score 0.0 (healthy, excluded)
    const embeddings = {
      embeddings: {
        "note-a": { noteId: "note-a", vector: [1, 0, 0], model: "m", createdAt: "t" },
        "note-b": { noteId: "note-b", vector: [0.99, 0.14, 0], model: "m", createdAt: "t" },
      },
    };

    const backlinks = {
      links: {
        "note-b": [
          { targetId: "note-x", similarity: 0.9, createdAt: "t" },
          { targetId: "note-y", similarity: 0.9, createdAt: "t" },
          { targetId: "note-z", similarity: 0.9, createdAt: "t" },
        ],
      },
    };

    const clusters = {
      clusters: {
        "cluster-0": {
          id: "cluster-0",
          centroid: [0.99, 0.14, 0],
          noteIds: ["note-b"],
          createdAt: "t",
          updatedAt: "t",
        },
      },
      computedAt: "t",
    };

    fetchSpy
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(embeddings), "emb-sha"))
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(backlinks), "bl-sha"))
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(clusters), "cl-sha"))
      .mockResolvedValueOnce(fakeGitHub404()) // decay.json → 404
      .mockResolvedValueOnce(fakeGitHubPut("decay-sha"));

    const response = await POST(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.message).toBe("Decay pass complete");
    expect(json.noteCount).toBe(2);
    expect(json.staleCount).toBeGreaterThan(0);
    expect(json.records).toBeDefined();
    expect(json.records.length).toBe(json.staleCount);

    // note-a should appear in stale records
    const noteARecord = json.records.find(
      (r: { noteId: string }) => r.noteId === "note-a",
    );
    expect(noteARecord).toBeDefined();
    expect(noteARecord.reasons).toContain("no-links");

    // Verify the decay write was called
    const writeCalls = fetchSpy.mock.calls.filter(
      (call: unknown[]) => (call[1] as RequestInit)?.method === "PUT",
    );
    expect(writeCalls).toHaveLength(1);

    // Verify the written content is valid JSON with records
    const body = JSON.parse(writeCalls[0][1]!.body as string);
    const decoded = JSON.parse(
      Buffer.from(body.content, "base64").toString("utf-8"),
    );
    expect(decoded.records).toBeDefined();
    expect(decoded.computedAt).toBeTruthy();
  });

  it("commits decay index even when all notes are healthy", async () => {
    // note-a has 3 links and is close to its cluster centroid → score 0.0
    const embeddings = {
      embeddings: {
        "note-a": { noteId: "note-a", vector: [1, 0, 0], model: "m", createdAt: "t" },
        "note-b": { noteId: "note-b", vector: [0.99, 0.14, 0], model: "m", createdAt: "t" },
        "note-c": { noteId: "note-c", vector: [0.98, 0.2, 0], model: "m", createdAt: "t" },
      },
    };

    const backlinks = {
      links: {
        "note-a": [
          { targetId: "note-b", similarity: 0.9, createdAt: "t" },
          { targetId: "note-c", similarity: 0.9, createdAt: "t" },
          { targetId: "note-x", similarity: 0.9, createdAt: "t" },
        ],
        "note-b": [
          { targetId: "note-a", similarity: 0.9, createdAt: "t" },
          { targetId: "note-c", similarity: 0.9, createdAt: "t" },
          { targetId: "note-x", similarity: 0.9, createdAt: "t" },
        ],
        "note-c": [
          { targetId: "note-a", similarity: 0.9, createdAt: "t" },
          { targetId: "note-b", similarity: 0.9, createdAt: "t" },
          { targetId: "note-x", similarity: 0.9, createdAt: "t" },
        ],
      },
    };

    const clusters = {
      clusters: {
        "cluster-0": {
          id: "cluster-0",
          centroid: [0.99, 0.14, 0],
          noteIds: ["note-a", "note-b", "note-c"],
          createdAt: "t",
          updatedAt: "t",
        },
      },
      computedAt: "t",
    };

    fetchSpy
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(embeddings), "emb-sha"))
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(backlinks), "bl-sha"))
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(clusters), "cl-sha"))
      .mockResolvedValueOnce(fakeGitHub404())
      .mockResolvedValueOnce(fakeGitHubPut("decay-sha"));

    const response = await POST(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.staleCount).toBe(0);
    expect(json.records).toEqual([]);

    // Still writes the decay index
    const writeCalls = fetchSpy.mock.calls.filter(
      (call: unknown[]) => (call[1] as RequestInit)?.method === "PUT",
    );
    expect(writeCalls).toHaveLength(1);
  });

  it("rejects unauthenticated requests", async () => {
    const request = new NextRequest("http://localhost/api/decay-pass", {
      method: "POST",
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });
});
