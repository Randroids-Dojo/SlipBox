import { describe, expect, it, vi } from "vitest";
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

function makeRequest() {
  return new NextRequest("http://localhost/api/theme-data", {
    method: "GET",
    headers: { Authorization: `Bearer ${TEST_API_KEY}` },
  });
}

const CLUSTERS = {
  clusters: {
    "cluster-0": {
      id: "cluster-0",
      centroid: [1, 0],
      noteIds: ["20260101T000000-aaaaaaaa", "20260101T000001-bbbbbbbb"],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  },
  computedAt: "2026-01-01T00:00:00Z",
};

const TENSIONS = {
  tensions: {
    "tension-0": {
      id: "tension-0",
      noteA: "20260101T000000-aaaaaaaa",
      noteB: "20260101T000001-bbbbbbbb",
      similarity: 0.65,
      clusterId: "cluster-0",
      detectedAt: "2026-01-01T00:00:00Z",
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/theme-data", () => {
  it("rejects unauthenticated requests", async () => {
    const request = new NextRequest("http://localhost/api/theme-data", {
      method: "GET",
    });

    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("returns empty state when no clusters exist", async () => {
    fetchSpy.spy
      // Read clusters.json → 404
      .mockResolvedValueOnce(fakeGitHub404())
      // Read tensions.json → 404
      .mockResolvedValueOnce(fakeGitHub404());

    const response = await GET(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.clusterCount).toBe(0);
    expect(json.noteCount).toBe(0);
    expect(json.clusters).toEqual([]);
    expect(json.message).toContain("cluster-pass");
  });

  it("returns clusters with note content", async () => {
    const noteAContent = serializedNote(
      "20260101T000000-aaaaaaaa",
      "Agents and ambiguity",
      "Agents shine when ambiguity exists.",
    );
    const noteBContent = serializedNote(
      "20260101T000001-bbbbbbbb",
      "Emergence in complex systems",
      "Complex systems produce emergent behaviour.",
    );

    fetchSpy.spy
      // Read clusters.json
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(CLUSTERS)))
      // Read tensions.json
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(TENSIONS)))
      // Read note A
      .mockResolvedValueOnce(fakeGitHubContents(noteAContent))
      // Read note B
      .mockResolvedValueOnce(fakeGitHubContents(noteBContent));

    const response = await GET(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.clusterCount).toBe(1);
    expect(json.noteCount).toBe(2);
    expect(json.clusters).toHaveLength(1);

    const cluster = json.clusters[0];
    expect(cluster.id).toBe("cluster-0");
    expect(cluster.noteIds).toHaveLength(2);

    const noteA = cluster.notes["20260101T000000-aaaaaaaa"];
    expect(noteA.title).toBe("Agents and ambiguity");
    expect(noteA.body).toBe("Agents shine when ambiguity exists.");

    const noteB = cluster.notes["20260101T000001-bbbbbbbb"];
    expect(noteB.title).toBe("Emergence in complex systems");
    expect(noteB.body).toBe("Complex systems produce emergent behaviour.");
  });

  it("includes tensions in the response", async () => {
    const noteAContent = serializedNote(
      "20260101T000000-aaaaaaaa",
      "Note A",
      "Body A.",
    );
    const noteBContent = serializedNote(
      "20260101T000001-bbbbbbbb",
      "Note B",
      "Body B.",
    );

    fetchSpy.spy
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(CLUSTERS)))
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(TENSIONS)))
      .mockResolvedValueOnce(fakeGitHubContents(noteAContent))
      .mockResolvedValueOnce(fakeGitHubContents(noteBContent));

    const response = await GET(makeRequest());
    const json = await response.json();

    expect(json.tensionCount).toBe(1);
    expect(json.tensions).toHaveLength(1);

    const tension = json.tensions[0];
    expect(tension.id).toBe("tension-0");
    expect(tension.noteA).toBe("20260101T000000-aaaaaaaa");
    expect(tension.noteB).toBe("20260101T000001-bbbbbbbb");
    expect(tension.similarity).toBe(0.65);
    expect(tension.clusterId).toBe("cluster-0");
  });

  it("omits notes that cannot be fetched from PrivateBox", async () => {
    const noteAContent = serializedNote(
      "20260101T000000-aaaaaaaa",
      "Note A",
      "Body A.",
    );

    fetchSpy.spy
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(CLUSTERS)))
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(TENSIONS)))
      // Note A found
      .mockResolvedValueOnce(fakeGitHubContents(noteAContent))
      // Note B missing
      .mockResolvedValueOnce(fakeGitHub404());

    const response = await GET(makeRequest());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.noteCount).toBe(2); // both IDs counted
    const cluster = json.clusters[0];
    expect(Object.keys(cluster.notes)).toHaveLength(1); // only A in notes map
    expect(cluster.notes["20260101T000000-aaaaaaaa"]).toBeDefined();
    expect(cluster.notes["20260101T000001-bbbbbbbb"]).toBeUndefined();
  });

  it("includes computedAt from clusters index", async () => {
    const noteAContent = serializedNote(
      "20260101T000000-aaaaaaaa",
      "Note A",
      "Body A.",
    );
    const noteBContent = serializedNote(
      "20260101T000001-bbbbbbbb",
      "Note B",
      "Body B.",
    );

    fetchSpy.spy
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(CLUSTERS)))
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(TENSIONS)))
      .mockResolvedValueOnce(fakeGitHubContents(noteAContent))
      .mockResolvedValueOnce(fakeGitHubContents(noteBContent));

    const response = await GET(makeRequest());
    const json = await response.json();

    expect(json.computedAt).toBe("2026-01-01T00:00:00Z");
  });
});
