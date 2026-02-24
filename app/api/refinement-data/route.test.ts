import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  TEST_API_KEY,
  setupTestEnv,
  setupFetchSpy,
  fakeGitHub404,
  fakeGitHubContents,
} from "../__test-setup__";
import { GET } from "./route";

setupTestEnv();
const fetchSpy = setupFetchSpy();

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
    fetchSpy.spy
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

    fetchSpy.spy
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

    fetchSpy.spy
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
    fetchSpy.spy
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
