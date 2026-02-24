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

const NOTE_A = "20260101T000000-aaaaaaaa";
const NOTE_B = "20260101T000001-bbbbbbbb";

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/refinements", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TEST_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/refinements", () => {
  it("rejects unauthenticated requests", async () => {
    const request = new NextRequest("http://localhost/api/refinements", {
      method: "POST",
      body: JSON.stringify({ suggestions: [] }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("rejects missing suggestions array", async () => {
    const response = await POST(makeRequest({}));
    expect(response.status).toBe(400);
  });

  it("rejects empty suggestions array", async () => {
    const response = await POST(makeRequest({ suggestions: [] }));
    expect(response.status).toBe(400);
  });

  it("rejects non-object element in suggestions array", async () => {
    const response = await POST(makeRequest({ suggestions: [null] }));
    expect(response.status).toBe(400);
  });

  it("rejects suggestion missing required suggestion field", async () => {
    const response = await POST(
      makeRequest({
        suggestions: [{ noteId: NOTE_A, type: "retitle", reason: "Because." }],
      }),
    );
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("suggestion");
  });

  it("rejects unknown refinement type", async () => {
    const response = await POST(
      makeRequest({
        suggestions: [
          { noteId: NOTE_A, type: "rewrite", suggestion: "...", reason: "..." },
        ],
      }),
    );
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("rewrite");
  });

  it("persists valid suggestions and returns updated count", async () => {
    fetchSpy.spy
      // Read refinements.json → 404 (empty)
      .mockResolvedValueOnce(fakeGitHub404())
      // Write refinements.json
      .mockResolvedValueOnce(fakeGitHubPut("ref-sha"));

    const response = await POST(
      makeRequest({
        suggestions: [
          {
            noteId: NOTE_A,
            type: "retitle",
            suggestion: "Agents and Autonomy",
            reason: "Current title is vague.",
          },
          {
            noteId: NOTE_B,
            type: "merge-suggest",
            suggestion: "Merge with Note A — both discuss agent decision-making.",
            reason: "High semantic overlap.",
            relatedNoteIds: [NOTE_A],
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.updated).toBe(2);
    expect(json.total).toBe(2);

    // Verify the written content
    const writeCalls = fetchSpy.spy.mock.calls.filter(
      (call: unknown[]) => (call[1] as RequestInit)?.method === "PUT",
    );
    expect(writeCalls).toHaveLength(1);

    const body = JSON.parse(writeCalls[0][1]!.body as string);
    const decoded = JSON.parse(
      Buffer.from(body.content, "base64").toString("utf-8"),
    );

    const key = `${NOTE_A}:retitle`;
    expect(decoded.suggestions[key]).toBeDefined();
    expect(decoded.suggestions[key].noteId).toBe(NOTE_A);
    expect(decoded.suggestions[key].type).toBe("retitle");
    expect(decoded.suggestions[key].suggestion).toBe("Agents and Autonomy");

    const mergeKey = `${NOTE_B}:merge-suggest`;
    expect(decoded.suggestions[mergeKey].relatedNoteIds).toContain(NOTE_A);
  });

  it("upserts by noteId + type, overwriting prior suggestion", async () => {
    const existing = {
      suggestions: {
        [`${NOTE_A}:retitle`]: {
          id: `${NOTE_A}:retitle`,
          noteId: NOTE_A,
          type: "retitle",
          suggestion: "Old title",
          reason: "Old reason",
          relatedNoteIds: [],
          generatedAt: "2026-01-01T00:00:00Z",
        },
      },
      updatedAt: "2026-01-01T00:00:00Z",
    };

    fetchSpy.spy
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(existing), "old-sha"))
      .mockResolvedValueOnce(fakeGitHubPut("new-sha"));

    const response = await POST(
      makeRequest({
        suggestions: [
          {
            noteId: NOTE_A,
            type: "retitle",
            suggestion: "New improved title",
            reason: "Better reflects content.",
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.updated).toBe(1);
    // total is still 1 (upsert, not append)
    expect(json.total).toBe(1);

    const writeCalls = fetchSpy.spy.mock.calls.filter(
      (call: unknown[]) => (call[1] as RequestInit)?.method === "PUT",
    );
    const body = JSON.parse(writeCalls[0][1]!.body as string);
    const decoded = JSON.parse(
      Buffer.from(body.content, "base64").toString("utf-8"),
    );

    expect(decoded.suggestions[`${NOTE_A}:retitle`].suggestion).toBe(
      "New improved title",
    );
  });
});
