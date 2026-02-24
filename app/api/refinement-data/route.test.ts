import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOTE_A = "20260101T000000-aaaaaaaa";
const NOTE_B = "20260101T000001-bbbbbbbb";
const NOTE_C = "20260101T000002-cccccccc";

const CLUSTERS = {
  clusters: {
    "cluster-0": {
      id: "cluster-0",
      centroid: [1, 0],
      noteIds: [NOTE_A, NOTE_B],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    "cluster-1": {
      id: "cluster-1",
      centroid: [0, 1],
      noteIds: [NOTE_C],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  },
  computedAt: "2026-01-01T00:00:00Z",
};

const DECAY = {
  records: {
    [NOTE_A]: {
      noteId: NOTE_A,
      score: 0.6,
      reasons: ["no-links", "low-link-density"],
      computedAt: "2026-01-01T00:00:00Z",
    },
  },
  computedAt: "2026-01-01T00:00:00Z",
};

function serializedNote(id: string, title: string, body: string): string {
  return [
    "---",
    `id: ${id}`,
    `title: "${title}"`,
    "tags: []",
    "created: 2026-01-01T00:00:00.000Z",
    "updated: 2026-01-01T00:00:00.000Z",
    "---",
    "",
    body,
    "",
  ].join("\n");
}

function makeRequest(url = "http://localhost/api/refinement-data") {
  return new NextRequest(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${TEST_API_KEY}` },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/refinement-data", () => {
  it("rejects unauthenticated requests", async () => {
    const request = new NextRequest("http://localhost/api/refinement-data", {
      method: "GET",
    });

    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("returns empty state when no clusters exist", async () => {
    fetchSpy
      // Read clusters.json → 404
      .mockResolvedValueOnce(fakeGitHub404())
      // Read decay.json → 404
      .mockResolvedValueOnce(fakeGitHub404());

    const response = await GET(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.clusterCount).toBe(0);
    expect(json.clusters).toEqual([]);
    expect(json.message).toContain("cluster-pass");
    expect(json.computedAt).toBeDefined();
  });

  it("returns clusters with full note content and decay info", async () => {
    const rawNoteA = serializedNote(NOTE_A, "Title A", "Body A.");
    const rawNoteB = serializedNote(NOTE_B, "Title B", "Body B.");
    const rawNoteC = serializedNote(NOTE_C, "Title C", "Body C.");

    fetchSpy
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(CLUSTERS)))
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(DECAY)))
      .mockResolvedValueOnce(fakeGitHubContents(rawNoteA))
      .mockResolvedValueOnce(fakeGitHubContents(rawNoteB))
      .mockResolvedValueOnce(fakeGitHubContents(rawNoteC));

    const response = await GET(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.clusterCount).toBe(2);
    expect(json.noteCount).toBe(3);

    const c0 = json.clusters.find((c: { id: string }) => c.id === "cluster-0");
    expect(c0).toBeDefined();
    expect(c0.memberCount).toBe(2);
    expect(c0.notes[NOTE_A]).toBeDefined();
    expect(c0.notes[NOTE_A].title).toBe("Title A");
    expect(c0.notes[NOTE_A].body).toBe("Body A.");
    // NOTE_A has a decay record
    expect(c0.notes[NOTE_A].decay).toBeDefined();
    expect(c0.notes[NOTE_A].decay.score).toBe(0.6);
    expect(c0.notes[NOTE_A].decay.reasons).toContain("no-links");
    // NOTE_B has no decay record
    expect(c0.notes[NOTE_B].decay).toBeUndefined();
  });

  it("filters by clusterId query param", async () => {
    const rawNoteA = serializedNote(NOTE_A, "Title A", "Body A.");
    const rawNoteB = serializedNote(NOTE_B, "Title B", "Body B.");

    fetchSpy
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(CLUSTERS)))
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(DECAY)))
      .mockResolvedValueOnce(fakeGitHubContents(rawNoteA))
      .mockResolvedValueOnce(fakeGitHubContents(rawNoteB));

    const response = await GET(
      makeRequest("http://localhost/api/refinement-data?clusterId=cluster-0"),
    );
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.clusterCount).toBe(1);
    expect(json.clusters[0].id).toBe("cluster-0");
    // cluster-1 notes should not appear
    expect(json.noteCount).toBe(2);
  });

  it("returns not-found message for unknown clusterId", async () => {
    fetchSpy
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(CLUSTERS)))
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(DECAY)));

    const response = await GET(
      makeRequest("http://localhost/api/refinement-data?clusterId=cluster-999"),
    );
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.clusterCount).toBe(0);
    expect(json.message).toContain("cluster-999");
  });
});
