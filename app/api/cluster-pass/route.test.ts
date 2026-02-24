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

function makeRequest(body?: object): NextRequest {
  return new NextRequest("http://localhost/api/cluster-pass", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TEST_API_KEY}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/cluster-pass", () => {
  it("returns not-enough-notes when no embeddings exist", async () => {
    fetchSpy.spy
      // Read embeddings.json → 404
      .mockResolvedValueOnce(fakeGitHub404())
      // Read clusters.json → 404
      .mockResolvedValueOnce(fakeGitHub404());

    const response = await POST(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.noteCount).toBe(0);
    expect(json.clusterCount).toBe(0);
  });

  it("returns not-enough-notes for fewer than MIN_NOTES_FOR_CLUSTERING", async () => {
    const embeddings = {
      embeddings: {
        "note-a": {
          noteId: "note-a",
          vector: [1, 0, 0],
          model: "m",
          createdAt: "t",
        },
        "note-b": {
          noteId: "note-b",
          vector: [0, 1, 0],
          model: "m",
          createdAt: "t",
        },
      },
    };

    fetchSpy.spy
      .mockResolvedValueOnce(
        fakeGitHubContents(JSON.stringify(embeddings), "emb-sha"),
      )
      .mockResolvedValueOnce(fakeGitHub404());

    const response = await POST(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.noteCount).toBe(2);
    expect(json.clusterCount).toBe(0);
    expect(json.message).toContain("Not enough notes");
  });

  it("clusters notes and commits results", async () => {
    // 6 notes in two clear groups
    const embeddings = {
      embeddings: {
        "note-a": {
          noteId: "note-a",
          vector: [0, 0, 0],
          model: "m",
          createdAt: "t",
        },
        "note-b": {
          noteId: "note-b",
          vector: [1, 0, 0],
          model: "m",
          createdAt: "t",
        },
        "note-c": {
          noteId: "note-c",
          vector: [0, 1, 0],
          model: "m",
          createdAt: "t",
        },
        "note-d": {
          noteId: "note-d",
          vector: [100, 100, 100],
          model: "m",
          createdAt: "t",
        },
        "note-e": {
          noteId: "note-e",
          vector: [101, 100, 100],
          model: "m",
          createdAt: "t",
        },
        "note-f": {
          noteId: "note-f",
          vector: [100, 101, 100],
          model: "m",
          createdAt: "t",
        },
      },
    };

    fetchSpy.spy
      // Read embeddings.json
      .mockResolvedValueOnce(
        fakeGitHubContents(JSON.stringify(embeddings), "emb-sha"),
      )
      // Read clusters.json → 404
      .mockResolvedValueOnce(fakeGitHub404())
      // Write clusters.json
      .mockResolvedValueOnce(fakeGitHubPut("cl-sha"));

    const response = await POST(makeRequest({ k: 2 }));
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.noteCount).toBe(6);
    expect(json.clusterCount).toBe(2);
    expect(json.clusters).toHaveLength(2);

    // All notes should be assigned
    const allNoteIds = json.clusters
      .flatMap((c: { noteIds: string[] }) => c.noteIds)
      .sort();
    expect(allNoteIds).toEqual([
      "note-a",
      "note-b",
      "note-c",
      "note-d",
      "note-e",
      "note-f",
    ]);

    // Verify the clusters write was called
    const writeCalls = fetchSpy.spy.mock.calls.filter(
      (call: unknown[]) => (call[1] as RequestInit)?.method === "PUT",
    );
    expect(writeCalls).toHaveLength(1);

    // Verify the written content is valid JSON
    const body = JSON.parse(writeCalls[0][1]!.body as string);
    const decoded = JSON.parse(
      Buffer.from(body.content, "base64").toString("utf-8"),
    );
    expect(decoded.clusters).toBeDefined();
    expect(decoded.computedAt).toBeTruthy();
  });

  it("rejects invalid k parameter", async () => {
    const response = await POST(makeRequest({ k: 1 }));
    expect(response.status).toBe(400);

    const json = await response.json();
    expect(json.error).toContain("'k' must be an integer >= 2");
  });

  it("rejects unauthenticated requests", async () => {
    const request = new NextRequest("http://localhost/api/cluster-pass", {
      method: "POST",
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });
});
