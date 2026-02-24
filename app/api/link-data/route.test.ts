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

function makeRequest(search: string = "") {
  return new NextRequest(`http://localhost/api/link-data${search}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${TEST_API_KEY}` },
  });
}

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

const NOTE_A_ID = "20260101T000000-aaaaaaaa";
const NOTE_B_ID = "20260101T000001-bbbbbbbb";
const NOTE_C_ID = "20260101T000002-cccccccc";

// Backlinks index with one pair: A ↔ B
const BACKLINKS_ONE_PAIR = {
  links: {
    [NOTE_A_ID]: [{ targetId: NOTE_B_ID, similarity: 0.91 }],
    [NOTE_B_ID]: [{ targetId: NOTE_A_ID, similarity: 0.91 }],
  },
};

// Backlinks index with two pairs: A ↔ B and A ↔ C
const BACKLINKS_TWO_PAIRS = {
  links: {
    [NOTE_A_ID]: [
      { targetId: NOTE_B_ID, similarity: 0.91 },
      { targetId: NOTE_C_ID, similarity: 0.85 },
    ],
    [NOTE_B_ID]: [{ targetId: NOTE_A_ID, similarity: 0.91 }],
    [NOTE_C_ID]: [{ targetId: NOTE_A_ID, similarity: 0.85 }],
  },
};

const EMPTY_RELATIONS = {
  relations: {},
  updatedAt: "2026-01-01T00:00:00Z",
};

const RELATIONS_A_B_CLASSIFIED = {
  relations: {
    [`${NOTE_A_ID}:${NOTE_B_ID}`]: {
      noteA: NOTE_A_ID,
      noteB: NOTE_B_ID,
      relationType: "supports",
      reason: "A provides evidence for B.",
      similarity: 0.91,
      classifiedAt: "2026-01-01T00:00:00Z",
    },
  },
  updatedAt: "2026-01-01T00:00:00Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/link-data", () => {
  it("rejects unauthenticated requests", async () => {
    const request = new NextRequest("http://localhost/api/link-data", {
      method: "GET",
    });

    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("returns empty pairs when backlinks index does not exist", async () => {
    fetchSpy.spy
      // readBacklinksIndex → 404
      .mockResolvedValueOnce(fakeGitHub404())
      // readRelationsIndex → 404
      .mockResolvedValueOnce(fakeGitHub404());

    const response = await GET(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.pairs).toEqual([]);
    expect(json.pairCount).toBe(0);
    expect(json.classifiedCount).toBe(0);
    expect(json.computedAt).toBeDefined();
  });

  it("returns deduplicated pairs with note content", async () => {
    const noteAContent = serializedNote(NOTE_A_ID, "Idea Alpha", "Alpha body.");
    const noteBContent = serializedNote(NOTE_B_ID, "Idea Beta", "Beta body.");

    fetchSpy.spy
      // readBacklinksIndex
      .mockResolvedValueOnce(
        fakeGitHubContents(JSON.stringify(BACKLINKS_ONE_PAIR)),
      )
      // readRelationsIndex
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(EMPTY_RELATIONS)))
      // readNote A
      .mockResolvedValueOnce(fakeGitHubContents(noteAContent))
      // readNote B
      .mockResolvedValueOnce(fakeGitHubContents(noteBContent));

    const response = await GET(makeRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    // Bidirectional backlinks → only 1 unique pair
    expect(json.pairCount).toBe(1);
    expect(json.pairs).toHaveLength(1);

    const pair = json.pairs[0];
    expect(pair.noteA).toBe(NOTE_A_ID);
    expect(pair.noteB).toBe(NOTE_B_ID);
    expect(pair.similarity).toBe(0.91);
    expect(pair.noteAContent.title).toBe("Idea Alpha");
    expect(pair.noteAContent.body).toBe("Alpha body.");
    expect(pair.noteBContent.title).toBe("Idea Beta");
    expect(pair.relation).toBeNull();
    expect(json.classifiedCount).toBe(0);
  });

  it("includes existing relation when pair has been classified", async () => {
    const noteAContent = serializedNote(NOTE_A_ID, "Note A", "Body A.");
    const noteBContent = serializedNote(NOTE_B_ID, "Note B", "Body B.");

    fetchSpy.spy
      .mockResolvedValueOnce(
        fakeGitHubContents(JSON.stringify(BACKLINKS_ONE_PAIR)),
      )
      .mockResolvedValueOnce(
        fakeGitHubContents(JSON.stringify(RELATIONS_A_B_CLASSIFIED)),
      )
      .mockResolvedValueOnce(fakeGitHubContents(noteAContent))
      .mockResolvedValueOnce(fakeGitHubContents(noteBContent));

    const response = await GET(makeRequest());
    const json = await response.json();

    expect(json.pairCount).toBe(1);
    expect(json.classifiedCount).toBe(1);

    const pair = json.pairs[0];
    expect(pair.relation).not.toBeNull();
    expect(pair.relation.relationType).toBe("supports");
    expect(pair.relation.reason).toBe("A provides evidence for B.");
    expect(pair.relation.similarity).toBe(0.91);
  });

  it("filters to unclassified pairs when ?unclassifiedOnly=true", async () => {
    // Two pairs: A↔B (classified) and A↔C (not classified)
    const noteAContent = serializedNote(NOTE_A_ID, "Note A", "Body A.");
    const noteCContent = serializedNote(NOTE_C_ID, "Note C", "Body C.");

    fetchSpy.spy
      .mockResolvedValueOnce(
        fakeGitHubContents(JSON.stringify(BACKLINKS_TWO_PAIRS)),
      )
      .mockResolvedValueOnce(
        fakeGitHubContents(JSON.stringify(RELATIONS_A_B_CLASSIFIED)),
      )
      // Only A and C are fetched (B is filtered out)
      .mockResolvedValueOnce(fakeGitHubContents(noteAContent))
      .mockResolvedValueOnce(fakeGitHubContents(noteCContent));

    const response = await GET(makeRequest("?unclassifiedOnly=true"));
    const json = await response.json();

    // Only the A↔C pair should be returned
    expect(json.pairCount).toBe(1);
    expect(json.pairs).toHaveLength(1);
    expect(json.pairs[0].noteA).toBe(NOTE_A_ID);
    expect(json.pairs[0].noteB).toBe(NOTE_C_ID);
    expect(json.pairs[0].relation).toBeNull();

    // classifiedCount reflects the full set, not just the filtered view
    expect(json.classifiedCount).toBe(1);
  });

  it("sets noteContent to null for notes that cannot be fetched", async () => {
    fetchSpy.spy
      .mockResolvedValueOnce(
        fakeGitHubContents(JSON.stringify(BACKLINKS_ONE_PAIR)),
      )
      .mockResolvedValueOnce(fakeGitHubContents(JSON.stringify(EMPTY_RELATIONS)))
      // Note A found
      .mockResolvedValueOnce(
        fakeGitHubContents(
          serializedNote(NOTE_A_ID, "Note A", "Body A."),
        ),
      )
      // Note B missing
      .mockResolvedValueOnce(fakeGitHub404());

    const response = await GET(makeRequest());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.pairCount).toBe(1);

    const pair = json.pairs[0];
    expect(pair.noteAContent).not.toBeNull();
    expect(pair.noteBContent).toBeNull();
  });
});
