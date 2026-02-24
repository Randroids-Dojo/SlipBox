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
  return new NextRequest("http://localhost/api/exploration-pass", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TEST_API_KEY}`,
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/exploration-pass", () => {
  it("returns zero suggestions when all indexes are empty", async () => {
    fetchSpy.spy
      .mockResolvedValueOnce(fakeGitHub404()) // embeddings
      .mockResolvedValueOnce(fakeGitHub404()) // backlinks
      .mockResolvedValueOnce(fakeGitHub404()) // clusters
      .mockResolvedValueOnce(fakeGitHub404()) // relations
      .mockResolvedValueOnce(fakeGitHub404()) // explorations
      .mockResolvedValueOnce(fakeGitHubPut("exp-sha")); // write

    const response = await POST(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.message).toBe("Exploration pass complete");
    expect(json.suggestionCount).toBe(0);
    expect(json.suggestions).toEqual([]);
    expect(json.byType).toEqual({});
  });

  it("detects orphan notes and commits explorations index", async () => {
    const embeddings = {
      embeddings: {
        "note-a": { noteId: "note-a", vector: [1, 0, 0], model: "m", createdAt: "t" },
        "note-b": { noteId: "note-b", vector: [0, 1, 0], model: "m", createdAt: "t" },
      },
    };
    // note-b has no backlinks (orphan); note-a has a link
    const backlinks = {
      links: {
        "note-a": [{ targetId: "note-b", similarity: 0.9, createdAt: "t" }],
      },
    };
    const clusters = { clusters: {}, computedAt: "t" };
    const relations = { relations: {}, updatedAt: "t" };

    fetchSpy.spy
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(embeddings), "emb-sha"))
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(backlinks), "bl-sha"))
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(clusters), "cl-sha"))
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(relations), "rel-sha"))
      .mockResolvedValueOnce(fakeGitHub404()) // explorations → 404
      .mockResolvedValueOnce(fakeGitHubPut("exp-sha")); // write

    const response = await POST(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.suggestionCount).toBeGreaterThan(0);
    expect(json.byType["orphan-note"]).toBeGreaterThan(0);

    const orphan = json.suggestions.find(
      (s: { type: string; noteId?: string }) =>
        s.type === "orphan-note" && s.noteId === "note-b",
    );
    expect(orphan).toBeDefined();

    // Verify write was called
    const writeCalls = fetchSpy.spy.mock.calls.filter(
      (call: unknown[]) => (call[1] as RequestInit)?.method === "PUT",
    );
    expect(writeCalls).toHaveLength(1);

    const body = JSON.parse(writeCalls[0][1]!.body as string);
    const decoded = JSON.parse(
      Buffer.from(body.content, "base64").toString("utf-8"),
    );
    expect(decoded.suggestions).toBeDefined();
    expect(decoded.computedAt).toBeTruthy();
  });

  it("detects structural holes and meta-note-missing with cluster data", async () => {
    const embeddings = { embeddings: {} };
    const backlinks = { links: {} };
    const clusters = {
      clusters: {
        "c1": {
          id: "c1",
          centroid: [1, 0, 0],
          noteIds: ["note-a"],
          createdAt: "t",
          updatedAt: "t",
        },
      },
      computedAt: "t",
    };
    const relations = { relations: {}, updatedAt: "t" };

    // note-a has no type: meta → meta-note-missing; no external relations → structural-hole
    const noteContent = `---\ntitle: Test Note\n---\n\nSome content.`;

    fetchSpy.spy
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(embeddings), "emb-sha"))
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(backlinks), "bl-sha"))
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(clusters), "cl-sha"))
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(relations), "rel-sha"))
      .mockResolvedValueOnce(fakeGitHub404()) // explorations → 404
      .mockResolvedValueOnce(fakeGitHubContents(noteContent, "note-sha")) // readNote note-a
      .mockResolvedValueOnce(fakeGitHubPut("exp-sha")); // write

    const response = await POST(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.byType["structural-hole"]).toBe(1);
    expect(json.byType["meta-note-missing"]).toBe(1);
  });

  it("does not flag meta-note-missing when cluster has a meta note", async () => {
    const embeddings = { embeddings: {} };
    const backlinks = { links: {} };
    const clusters = {
      clusters: {
        "c1": {
          id: "c1",
          centroid: [1, 0, 0],
          noteIds: ["meta-note-1"],
          createdAt: "t",
          updatedAt: "t",
        },
      },
      computedAt: "t",
    };
    const relations = { relations: {}, updatedAt: "t" };

    // meta-note-1 has type: meta in frontmatter
    const metaNoteContent = `---\ntitle: Cluster Summary\ntype: meta\n---\n\nMeta content.`;

    fetchSpy.spy
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(embeddings), "emb-sha"))
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(backlinks), "bl-sha"))
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(clusters), "cl-sha"))
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(relations), "rel-sha"))
      .mockResolvedValueOnce(fakeGitHub404()) // explorations → 404
      .mockResolvedValueOnce(fakeGitHubContents(metaNoteContent, "note-sha")) // readNote
      .mockResolvedValueOnce(fakeGitHubPut("exp-sha")); // write

    const response = await POST(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.byType["meta-note-missing"]).toBeUndefined();
  });

  it("rejects unauthenticated requests", async () => {
    const request = new NextRequest("http://localhost/api/exploration-pass", {
      method: "POST",
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });
});
