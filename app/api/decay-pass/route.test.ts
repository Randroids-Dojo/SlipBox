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
    fetchSpy.spy
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

    fetchSpy.spy
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
    const writeCalls = fetchSpy.spy.mock.calls.filter(
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

    fetchSpy.spy
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
    const writeCalls = fetchSpy.spy.mock.calls.filter(
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
