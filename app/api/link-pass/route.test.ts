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
  return new NextRequest("http://localhost/api/link-pass", {
    method: "POST",
    headers: { Authorization: `Bearer ${TEST_API_KEY}` },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/link-pass", () => {
  it("returns zero links when no notes exist", async () => {
    fetchSpy.spy
      // Read embeddings.json → 404
      .mockResolvedValueOnce(fakeGitHub404())
      // Read backlinks.json → 404
      .mockResolvedValueOnce(fakeGitHub404());

    const response = await POST(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.message).toBe("No notes to link");
    expect(json.totalLinks).toBe(0);
  });

  it("recomputes links between similar notes", async () => {
    const vec = [0.1, 0.2, 0.3, 0.4, 0.5];
    const embeddings = {
      embeddings: {
        "note-a": { noteId: "note-a", vector: vec, model: "m", createdAt: "t" },
        "note-b": { noteId: "note-b", vector: vec, model: "m", createdAt: "t" },
      },
    };

    fetchSpy.spy
      // Read embeddings.json
      .mockResolvedValueOnce(
        fakeGitHubContents(JSON.stringify(embeddings), "emb-sha"),
      )
      // Read backlinks.json → 404
      .mockResolvedValueOnce(fakeGitHub404())
      // Write backlinks.json
      .mockResolvedValueOnce(fakeGitHubPut("bl-sha"));

    const response = await POST(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.notesProcessed).toBe(2);
    expect(json.totalLinks).toBe(1); // 1 unique pair

    // Verify the backlinks write
    const writeCalls = fetchSpy.spy.mock.calls.filter(
      (call: unknown[]) => (call[1] as RequestInit)?.method === "PUT",
    );
    expect(writeCalls).toHaveLength(1);

    const body = JSON.parse(writeCalls[0][1]!.body as string);
    const decoded = JSON.parse(
      Buffer.from(body.content, "base64").toString("utf-8"),
    );
    // Both notes should have bidirectional links
    expect(decoded.links["note-a"]).toHaveLength(1);
    expect(decoded.links["note-b"]).toHaveLength(1);
  });

  it("produces no links for dissimilar notes", async () => {
    const embeddings = {
      embeddings: {
        "note-a": {
          noteId: "note-a",
          vector: [1, 0, 0, 0, 0],
          model: "m",
          createdAt: "t",
        },
        "note-b": {
          noteId: "note-b",
          vector: [0, 0, 0, 0, 1],
          model: "m",
          createdAt: "t",
        },
      },
    };

    fetchSpy.spy
      .mockResolvedValueOnce(
        fakeGitHubContents(JSON.stringify(embeddings), "emb-sha"),
      )
      .mockResolvedValueOnce(fakeGitHub404())
      // Still writes backlinks (empty)
      .mockResolvedValueOnce(fakeGitHubPut());

    const response = await POST(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.totalLinks).toBe(0);
  });
});
