import { describe, expect, it, vi } from "vitest";
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
  return new NextRequest("http://localhost/api/tension-pass", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TEST_API_KEY}`,
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/tension-pass", () => {
  it("returns not-enough-notes when embeddings are empty", async () => {
    fetchSpy.spy
      // Read embeddings.json → 404
      .mockResolvedValueOnce(fakeGitHub404())
      // Read clusters.json → 404
      .mockResolvedValueOnce(fakeGitHub404())
      // Read tensions.json → 404
      .mockResolvedValueOnce(fakeGitHub404());

    const response = await POST(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.noteCount).toBe(0);
    expect(json.tensionCount).toBe(0);
    expect(json.message).toContain("Not enough notes");
  });

  it("returns 400 when no clusters exist", async () => {
    const embeddings = {
      embeddings: {
        "note-a": { noteId: "note-a", vector: [1, 0], model: "m", createdAt: "t" },
        "note-b": { noteId: "note-b", vector: [0, 1], model: "m", createdAt: "t" },
        "note-c": { noteId: "note-c", vector: [1, 1], model: "m", createdAt: "t" },
        "note-d": { noteId: "note-d", vector: [0, 0.5], model: "m", createdAt: "t" },
      },
    };

    fetchSpy.spy
      // Read embeddings.json
      .mockResolvedValueOnce(
        fakeGitHubContents(JSON.stringify(embeddings), "emb-sha"),
      )
      // Read clusters.json → 404 (no clusters)
      .mockResolvedValueOnce(fakeGitHub404())
      // Read tensions.json → 404
      .mockResolvedValueOnce(fakeGitHub404());

    const response = await POST(makeRequest());
    expect(response.status).toBe(400);

    const json = await response.json();
    expect(json.error).toContain("No clusters found");
  });

  it("detects tensions and commits results", async () => {
    // Two notes in same cluster with orthogonal vectors → tension
    const embeddings = {
      embeddings: {
        "note-a": { noteId: "note-a", vector: [1, 0, 0], model: "m", createdAt: "t" },
        "note-b": { noteId: "note-b", vector: [0, 1, 0], model: "m", createdAt: "t" },
        "note-c": { noteId: "note-c", vector: [0.99, 0.14, 0], model: "m", createdAt: "t" },
        "note-d": { noteId: "note-d", vector: [100, 100, 100], model: "m", createdAt: "t" },
      },
    };

    const clusters = {
      clusters: {
        "cluster-0": {
          id: "cluster-0",
          centroid: [0.5, 0.5, 0],
          noteIds: ["note-a", "note-b", "note-c"],
          createdAt: "t",
          updatedAt: "t",
        },
        "cluster-1": {
          id: "cluster-1",
          centroid: [100, 100, 100],
          noteIds: ["note-d"],
          createdAt: "t",
          updatedAt: "t",
        },
      },
      computedAt: "t",
    };

    fetchSpy.spy
      // Read embeddings.json
      .mockResolvedValueOnce(
        fakeGitHubContents(JSON.stringify(embeddings), "emb-sha"),
      )
      // Read clusters.json
      .mockResolvedValueOnce(
        fakeGitHubContents(JSON.stringify(clusters), "cl-sha"),
      )
      // Read tensions.json → 404
      .mockResolvedValueOnce(fakeGitHub404())
      // Write tensions.json
      .mockResolvedValueOnce(fakeGitHubPut("ten-sha"));

    const response = await POST(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.message).toBe("Tension pass complete");
    expect(json.noteCount).toBe(4);
    expect(json.clusterCount).toBe(2);
    expect(json.tensionCount).toBeGreaterThan(0);
    expect(json.tensions).toBeDefined();
    expect(json.tensions.length).toBe(json.tensionCount);

    // Verify the tensions write was called
    const writeCalls = fetchSpy.spy.mock.calls.filter(
      (call: unknown[]) => (call[1] as RequestInit)?.method === "PUT",
    );
    expect(writeCalls).toHaveLength(1);

    // Verify the written content is valid JSON with tensions
    const body = JSON.parse(writeCalls[0][1]!.body as string);
    const decoded = JSON.parse(
      Buffer.from(body.content, "base64").toString("utf-8"),
    );
    expect(decoded.tensions).toBeDefined();
    expect(decoded.computedAt).toBeTruthy();
  });

  it("returns zero tensions when all cluster members are aligned", async () => {
    // All notes in one cluster with very similar vectors
    const embeddings = {
      embeddings: {
        "note-a": { noteId: "note-a", vector: [1, 0, 0], model: "m", createdAt: "t" },
        "note-b": { noteId: "note-b", vector: [0.99, 0.14, 0], model: "m", createdAt: "t" },
        "note-c": { noteId: "note-c", vector: [0.98, 0.2, 0], model: "m", createdAt: "t" },
        "note-d": { noteId: "note-d", vector: [0.97, 0.24, 0], model: "m", createdAt: "t" },
      },
    };

    const clusters = {
      clusters: {
        "cluster-0": {
          id: "cluster-0",
          centroid: [0.985, 0.145, 0],
          noteIds: ["note-a", "note-b", "note-c", "note-d"],
          createdAt: "t",
          updatedAt: "t",
        },
      },
      computedAt: "t",
    };

    fetchSpy.spy
      .mockResolvedValueOnce(
        fakeGitHubContents(JSON.stringify(embeddings), "emb-sha"),
      )
      .mockResolvedValueOnce(
        fakeGitHubContents(JSON.stringify(clusters), "cl-sha"),
      )
      .mockResolvedValueOnce(fakeGitHub404())
      // Still writes the tensions index (with zero tensions)
      .mockResolvedValueOnce(fakeGitHubPut("ten-sha"));

    const response = await POST(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.tensionCount).toBe(0);
    expect(json.tensions).toEqual([]);
  });

  it("rejects unauthenticated requests", async () => {
    const request = new NextRequest("http://localhost/api/tension-pass", {
      method: "POST",
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });
});
