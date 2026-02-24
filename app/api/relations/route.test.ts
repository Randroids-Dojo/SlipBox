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
// Fixtures
// ---------------------------------------------------------------------------

const NOTE_A = "20260101T000000-aaaaaaaa";
const NOTE_B = "20260101T000001-bbbbbbbb";
const NOTE_C = "20260101T000002-cccccccc";

const BACKLINKS_A_B = {
  links: {
    [NOTE_A]: [{ targetId: NOTE_B, similarity: 0.91 }],
    [NOTE_B]: [{ targetId: NOTE_A, similarity: 0.91 }],
  },
};

const BACKLINKS_A_B_AND_A_C = {
  links: {
    [NOTE_A]: [
      { targetId: NOTE_B, similarity: 0.91 },
      { targetId: NOTE_C, similarity: 0.85 },
    ],
    [NOTE_B]: [{ targetId: NOTE_A, similarity: 0.91 }],
    [NOTE_C]: [{ targetId: NOTE_A, similarity: 0.85 }],
  },
};

const EMPTY_RELATIONS = {
  relations: {},
  updatedAt: "2026-01-01T00:00:00Z",
};

const RELATIONS_A_B_EXISTING = {
  relations: {
    [`${NOTE_A}:${NOTE_B}`]: {
      noteA: NOTE_A,
      noteB: NOTE_B,
      relationType: "supports",
      reason: "Prior reason.",
      similarity: 0.91,
      classifiedAt: "2026-01-01T00:00:00Z",
    },
  },
  updatedAt: "2026-01-01T00:00:00Z",
};

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/relations", {
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

describe("POST /api/relations", () => {
  it("rejects unauthenticated requests", async () => {
    const request = new NextRequest("http://localhost/api/relations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relations: [] }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("rejects malformed JSON body", async () => {
    const request = new NextRequest("http://localhost/api/relations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: "not json",
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const json = await response.json();
    expect(json.error).toContain("Invalid JSON");
  });

  it("rejects missing relations array", async () => {
    const response = await POST(makeRequest({ foo: "bar" }));
    expect(response.status).toBe(400);

    const json = await response.json();
    expect(json.error).toContain("relations");
  });

  it("rejects empty relations array", async () => {
    const response = await POST(makeRequest({ relations: [] }));
    expect(response.status).toBe(400);

    const json = await response.json();
    expect(json.error).toContain("empty");
  });

  it("rejects an unknown relationType", async () => {
    const response = await POST(
      makeRequest({
        relations: [
          {
            noteA: NOTE_A,
            noteB: NOTE_B,
            relationType: "invented-type",
            reason: "Some reason.",
          },
        ],
      }),
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("invented-type");
  });

  it("rejects a pair where noteA equals noteB", async () => {
    const response = await POST(
      makeRequest({
        relations: [
          {
            noteA: NOTE_A,
            noteB: NOTE_A,
            relationType: "supports",
            reason: "Self-loop.",
          },
        ],
      }),
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("different");
  });

  it("rejects a pair not present in the backlinks index", async () => {
    fetchSpy.spy
      // readBacklinksIndex — only A↔B exists
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(BACKLINKS_A_B)))
      // readRelationsIndex
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(EMPTY_RELATIONS)));

    // Submit A↔C which is not linked
    const response = await POST(
      makeRequest({
        relations: [
          {
            noteA: NOTE_A,
            noteB: NOTE_C,
            relationType: "supports",
            reason: "Should fail.",
          },
        ],
      }),
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("not found in backlinks index");
  });

  it("classifies a pair and commits the relations index", async () => {
    fetchSpy.spy
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(BACKLINKS_A_B)))
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(EMPTY_RELATIONS)))
      .mockResolvedValueOnce(fakeGitHubPut());

    const response = await POST(
      makeRequest({
        relations: [
          {
            noteA: NOTE_A,
            noteB: NOTE_B,
            relationType: "supports",
            reason: "A provides evidence for B.",
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.message).toBe("Relations updated");
    expect(json.updated).toBe(1);
    expect(json.total).toBe(1);

    // Verify write was called with correct content
    const writeCalls = fetchSpy.spy.mock.calls.filter(
      (call: unknown[]) => (call[1] as RequestInit)?.method === "PUT",
    );
    expect(writeCalls).toHaveLength(1);

    const body = JSON.parse(writeCalls[0][1]!.body as string);
    const decoded = JSON.parse(
      Buffer.from(body.content, "base64").toString("utf-8"),
    );
    const key = `${NOTE_A}:${NOTE_B}`;
    expect(decoded.relations[key]).toBeDefined();
    expect(decoded.relations[key].relationType).toBe("supports");
    expect(decoded.relations[key].similarity).toBe(0.91);
    expect(decoded.relations[key].reason).toBe("A provides evidence for B.");
    expect(decoded.relations[key].classifiedAt).toBeTruthy();
  });

  it("classifies multiple pairs in a single request", async () => {
    fetchSpy.spy
      .mockResolvedValueOnce(
        fakeGitHubContents(JSON.stringify(BACKLINKS_A_B_AND_A_C)),
      )
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(EMPTY_RELATIONS)))
      .mockResolvedValueOnce(fakeGitHubPut());

    const response = await POST(
      makeRequest({
        relations: [
          {
            noteA: NOTE_A,
            noteB: NOTE_B,
            relationType: "supports",
            reason: "A supports B.",
          },
          {
            noteA: NOTE_A,
            noteB: NOTE_C,
            relationType: "contrasts-with",
            reason: "A contrasts C.",
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.updated).toBe(2);
    expect(json.total).toBe(2);
  });

  it("overwrites an existing relation for the same pair (upsert)", async () => {
    fetchSpy.spy
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(BACKLINKS_A_B)))
      .mockResolvedValueOnce(
        fakeGitHubContents(JSON.stringify(RELATIONS_A_B_EXISTING)),
      )
      .mockResolvedValueOnce(fakeGitHubPut());

    const response = await POST(
      makeRequest({
        relations: [
          {
            noteA: NOTE_A,
            noteB: NOTE_B,
            relationType: "contradicts",
            reason: "Updated reason.",
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    // total stays at 1 — same pair, updated in place
    expect(json.updated).toBe(1);
    expect(json.total).toBe(1);

    const writeCalls = fetchSpy.spy.mock.calls.filter(
      (call: unknown[]) => (call[1] as RequestInit)?.method === "PUT",
    );
    const body = JSON.parse(writeCalls[0][1]!.body as string);
    const decoded = JSON.parse(
      Buffer.from(body.content, "base64").toString("utf-8"),
    );
    const key = `${NOTE_A}:${NOTE_B}`;
    expect(decoded.relations[key].relationType).toBe("contradicts");
    expect(decoded.relations[key].reason).toBe("Updated reason.");
  });

  it("accepts pairs submitted in reverse canonical order", async () => {
    fetchSpy.spy
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(BACKLINKS_A_B)))
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(EMPTY_RELATIONS)))
      .mockResolvedValueOnce(fakeGitHubPut());

    // Submit B→A instead of A→B
    const response = await POST(
      makeRequest({
        relations: [
          {
            noteA: NOTE_B,
            noteB: NOTE_A,
            relationType: "refines",
            reason: "B refines A.",
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.updated).toBe(1);

    const writeCalls = fetchSpy.spy.mock.calls.filter(
      (call: unknown[]) => (call[1] as RequestInit)?.method === "PUT",
    );
    const body = JSON.parse(writeCalls[0][1]!.body as string);
    const decoded = JSON.parse(
      Buffer.from(body.content, "base64").toString("utf-8"),
    );
    // Key must be in canonical order: NOTE_A < NOTE_B
    const key = `${NOTE_A}:${NOTE_B}`;
    expect(decoded.relations[key]).toBeDefined();
    expect(decoded.relations[key].relationType).toBe("refines");
  });
});
