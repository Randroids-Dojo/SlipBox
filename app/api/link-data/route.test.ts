import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

// ---------------------------------------------------------------------------
// Environment setup
// ---------------------------------------------------------------------------

const TEST_API_KEY = "sk-test-slipbox-key";

beforeEach(() => {
  process.env.SLIPBOX_API_KEY = TEST_API_KEY;
  process.env.GITHUB_TOKEN = "ghp_test_token";
  process.env.PRIVATEBOX_OWNER = "test-owner";
  process.env.PRIVATEBOX_REPO = "test-repo";
});

afterEach(() => {
  delete process.env.SLIPBOX_API_KEY;
  delete process.env.GITHUB_TOKEN;
  delete process.env.PRIVATEBOX_OWNER;
  delete process.env.PRIVATEBOX_REPO;
});

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

function fakeGitHub404() {
  return {
    ok: false,
    status: 404,
    json: async () => ({ message: "Not Found" }),
    text: async () => "Not Found",
  } as unknown as Response;
}

function fakeGitHubContents(content: string, sha: string = "sha123") {
  const encoded = Buffer.from(content, "utf-8").toString("base64");
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: encoded, sha, encoding: "base64" }),
    text: async () => "",
  } as unknown as Response;
}

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
    fetchSpy
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

    fetchSpy
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

    fetchSpy
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

    fetchSpy
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
    fetchSpy
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
