import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  TEST_API_KEY,
  setupTestEnv,
  setupFetchSpy,
  fakeGitHub404,
  fakeGitHubContents,
  fakeGitHubPut,
} from "../__test-setup__";
import { POST } from "./route";

setupTestEnv();
const fetchSpy = setupFetchSpy();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/snapshot", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TEST_API_KEY}`,
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/snapshot", () => {
  it("rejects unauthenticated requests", async () => {
    const request = new NextRequest("http://localhost/api/snapshot", {
      method: "POST",
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("captures and returns a snapshot when all indexes are empty", async () => {
    // All 5 indexes return 404 (empty), snapshots index also 404
    // Then writes the snapshots index
    fetchSpy.spy
      .mockResolvedValueOnce(fakeGitHub404()) // embeddings
      .mockResolvedValueOnce(fakeGitHub404()) // backlinks
      .mockResolvedValueOnce(fakeGitHub404()) // clusters
      .mockResolvedValueOnce(fakeGitHub404()) // tensions
      .mockResolvedValueOnce(fakeGitHub404()) // decay
      .mockResolvedValueOnce(fakeGitHub404()) // snapshots
      .mockResolvedValueOnce(fakeGitHubPut("snap-sha")); // write snapshots

    const response = await POST(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.snapshot).toBeDefined();
    expect(json.snapshot.id).toMatch(/^snapshot-\d+$/);
    expect(json.snapshot.noteCount).toBe(0);
    expect(json.snapshot.linkCount).toBe(0);
    expect(json.snapshot.clusterCount).toBe(0);
    expect(json.snapshot.tensionCount).toBe(0);
    expect(json.snapshot.decayCount).toBe(0);
    expect(json.snapshot.capturedAt).toBeTruthy();
  });

  it("appends snapshot to existing snapshots index", async () => {
    const existingSnapshots = {
      snapshots: [
        {
          id: "snapshot-1000",
          capturedAt: "2026-02-22T00:00:00.000Z",
          noteCount: 5,
          linkCount: 3,
          clusterCount: 2,
          tensionCount: 1,
          decayCount: 0,
          clusterSizes: { "cluster-0": 3, "cluster-1": 2 },
          avgLinksPerNote: 1.2,
        },
      ],
    };

    fetchSpy.spy
      .mockResolvedValueOnce(fakeGitHub404()) // embeddings
      .mockResolvedValueOnce(fakeGitHub404()) // backlinks
      .mockResolvedValueOnce(fakeGitHub404()) // clusters
      .mockResolvedValueOnce(fakeGitHub404()) // tensions
      .mockResolvedValueOnce(fakeGitHub404()) // decay
      .mockResolvedValueOnce(
        fakeGitHubContents(JSON.stringify(existingSnapshots), "old-sha"),
      ) // snapshots read
      .mockResolvedValueOnce(fakeGitHubPut("new-sha")); // snapshots write

    const response = await POST(makeRequest());
    expect(response.status).toBe(200);

    // Verify the written content has two snapshots
    const putCalls = fetchSpy.spy.mock.calls.filter(
      (call: unknown[]) => (call[1] as RequestInit)?.method === "PUT",
    );
    expect(putCalls).toHaveLength(1);

    const body = JSON.parse(putCalls[0][1]!.body as string);
    const decoded = JSON.parse(
      Buffer.from(body.content, "base64").toString("utf-8"),
    );
    expect(decoded.snapshots).toHaveLength(2);
    expect(decoded.snapshots[0].id).toBe("snapshot-1000");
  });

  it("captures metrics from populated indexes", async () => {
    const embeddings = {
      embeddings: {
        "note-a": { noteId: "note-a", vector: [1, 0], model: "m", createdAt: "t" },
        "note-b": { noteId: "note-b", vector: [0, 1], model: "m", createdAt: "t" },
        "note-c": { noteId: "note-c", vector: [1, 1], model: "m", createdAt: "t" },
      },
    };

    const backlinks = {
      links: {
        "note-a": [{ targetId: "note-b", similarity: 0.9 }],
        "note-b": [{ targetId: "note-a", similarity: 0.9 }],
      },
    };

    const clusters = {
      clusters: {
        "cluster-0": {
          id: "cluster-0",
          centroid: [0.5, 0.5],
          noteIds: ["note-a", "note-b"],
          createdAt: "t",
          updatedAt: "t",
        },
        "cluster-1": {
          id: "cluster-1",
          centroid: [1, 1],
          noteIds: ["note-c"],
          createdAt: "t",
          updatedAt: "t",
        },
      },
      computedAt: "t",
    };

    const tensions = {
      tensions: {
        "tension-0": {
          id: "tension-0",
          noteA: "note-a",
          noteB: "note-b",
          similarity: 0.2,
          clusterId: "cluster-0",
          detectedAt: "t",
        },
      },
      computedAt: "t",
    };

    const decay = {
      records: {
        "note-c": {
          noteId: "note-c",
          score: 0.5,
          reasons: ["no-links"],
          computedAt: "t",
        },
      },
      computedAt: "t",
    };

    fetchSpy.spy
      .mockResolvedValueOnce(
        fakeGitHubContents(JSON.stringify(embeddings), "emb-sha"),
      )
      .mockResolvedValueOnce(
        fakeGitHubContents(JSON.stringify(backlinks), "bl-sha"),
      )
      .mockResolvedValueOnce(
        fakeGitHubContents(JSON.stringify(clusters), "cl-sha"),
      )
      .mockResolvedValueOnce(
        fakeGitHubContents(JSON.stringify(tensions), "ten-sha"),
      )
      .mockResolvedValueOnce(
        fakeGitHubContents(JSON.stringify(decay), "dec-sha"),
      )
      .mockResolvedValueOnce(fakeGitHub404()) // snapshots (empty)
      .mockResolvedValueOnce(fakeGitHubPut("snap-sha"));

    const response = await POST(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    const snapshot = json.snapshot;

    expect(snapshot.noteCount).toBe(3);
    expect(snapshot.linkCount).toBe(1);
    expect(snapshot.clusterCount).toBe(2);
    expect(snapshot.tensionCount).toBe(1);
    expect(snapshot.decayCount).toBe(1);
    expect(snapshot.clusterSizes["cluster-0"]).toBe(2);
    expect(snapshot.clusterSizes["cluster-1"]).toBe(1);
  });
});
