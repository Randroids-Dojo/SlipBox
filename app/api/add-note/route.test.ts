import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

// ---------------------------------------------------------------------------
// Environment setup
// ---------------------------------------------------------------------------

const TEST_API_KEY = "sk-test-slipbox-key";

beforeEach(() => {
  process.env.SLIPBOX_API_KEY = TEST_API_KEY;
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.GITHUB_TOKEN = "ghp_test_token";
  process.env.PRIVATEBOX_OWNER = "test-owner";
  process.env.PRIVATEBOX_REPO = "test-repo";
});

afterEach(() => {
  delete process.env.SLIPBOX_API_KEY;
  delete process.env.OPENAI_API_KEY;
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

const FAKE_VECTOR = [0.1, 0.2, 0.3, 0.4, 0.5];

function fakeOpenAIEmbeddingResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: [{ embedding: FAKE_VECTOR, index: 0 }],
      model: "text-embedding-3-large",
      usage: { prompt_tokens: 5, total_tokens: 5 },
    }),
    text: async () => "",
  } as unknown as Response;
}

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

function fakeGitHubPut(sha: string = "newsha") {
  return {
    ok: true,
    status: 201,
    json: async () => ({ content: { sha } }),
    text: async () => "",
  } as unknown as Response;
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/add-note", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TEST_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/add-note", () => {
  it("returns 400 for missing content", async () => {
    const response = await POST(makeRequest({}));
    expect(response.status).toBe(400);

    const json = await response.json();
    expect(json.error).toContain("content");
  });

  it("returns 400 for empty content", async () => {
    const response = await POST(makeRequest({ content: "   " }));
    expect(response.status).toBe(400);
  });

  it("creates a note with no prior notes (bootstrapping)", async () => {
    // The pipeline will:
    // 1. Call OpenAI for embedding
    // 2. Read embeddings.json (404 → empty) — similarity pass
    // 3. Write note file          ─┐ concurrent
    // 4. Read backlinks.json       ├ (note PUT fires first, then backlinks GET)
    // 5. Write backlinks.json     ─┘
    // 6. Read embeddings.json (404 → empty) — upsert re-fetch
    // 7. Write embeddings.json — upsert write

    fetchSpy
      // 1. OpenAI embedding call
      .mockResolvedValueOnce(fakeOpenAIEmbeddingResponse())
      // 2. Read embeddings.json → 404 (similarity pass)
      .mockResolvedValueOnce(fakeGitHub404())
      // 3. Write note file
      .mockResolvedValueOnce(fakeGitHubPut("note-sha"))
      // 4. Read backlinks.json → 404 (backlinks retry-read)
      .mockResolvedValueOnce(fakeGitHub404())
      // 5. Write backlinks.json
      .mockResolvedValueOnce(fakeGitHubPut("bl-sha"))
      // 6. Read embeddings.json (upsert re-fetch) → 404
      .mockResolvedValueOnce(fakeGitHub404())
      // 7. Write embeddings.json (upsert write)
      .mockResolvedValueOnce(fakeGitHubPut("emb-sha"));

    const response = await POST(makeRequest({ content: "Agents shine when ambiguity exists." }));
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.noteId).toBeTruthy();
    expect(json.linkedNotes).toEqual([]);

    // Verify OpenAI was called
    const openaiCall = fetchSpy.mock.calls[0];
    expect(openaiCall[0]).toBe("https://api.openai.com/v1/embeddings");

    // Verify 3 write calls were made (note + backlinks + embeddings)
    const writeCalls = fetchSpy.mock.calls.filter(
      (call: unknown[]) => (call[1] as RequestInit)?.method === "PUT",
    );
    expect(writeCalls).toHaveLength(3);
  });

  it("returns 400 for an invalid note type", async () => {
    const response = await POST(makeRequest({ content: "Some content.", type: "invalid" }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("type");
  });

  it("creates a meta-note and returns type in response", async () => {
    fetchSpy
      .mockResolvedValueOnce(fakeOpenAIEmbeddingResponse())
      .mockResolvedValueOnce(fakeGitHub404()) // embeddings
      .mockResolvedValueOnce(fakeGitHubPut("note-sha")) // write note
      .mockResolvedValueOnce(fakeGitHub404()) // backlinks read
      .mockResolvedValueOnce(fakeGitHubPut("bl-sha")) // write backlinks
      .mockResolvedValueOnce(fakeGitHub404()) // embeddings upsert read
      .mockResolvedValueOnce(fakeGitHubPut("emb-sha")); // write embeddings

    const response = await POST(makeRequest({ content: "Cluster summary.", type: "meta" }));
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.type).toBe("meta");

    // Verify the note file written to GitHub contains type: meta in frontmatter
    const writeCalls = fetchSpy.mock.calls.filter(
      (call: unknown[]) => (call[1] as RequestInit)?.method === "PUT",
    );
    const noteWrite = writeCalls[0];
    const noteBody = JSON.parse(noteWrite[1]!.body as string);
    const noteContent = Buffer.from(noteBody.content, "base64").toString("utf-8");
    expect(noteContent).toContain("type: meta");
  });

  it("links to existing notes when similarity is above threshold", async () => {
    // Create an existing embeddings index with a note that has a very similar vector
    const existingEmbeddings = {
      embeddings: {
        "20260222T100000-existing1": {
          noteId: "20260222T100000-existing1",
          vector: FAKE_VECTOR, // Same vector = similarity 1.0
          model: "text-embedding-3-large",
          createdAt: "2026-02-22T10:00:00.000Z",
        },
      },
    };

    fetchSpy
      // 1. OpenAI embedding
      .mockResolvedValueOnce(fakeOpenAIEmbeddingResponse())
      // 2. Read embeddings.json (has existing note) — similarity pass
      .mockResolvedValueOnce(
        fakeGitHubContents(JSON.stringify(existingEmbeddings), "emb-sha"),
      )
      // 3. Write note file
      .mockResolvedValueOnce(fakeGitHubPut())
      // 4. Read backlinks.json → 404 (backlinks retry-read)
      .mockResolvedValueOnce(fakeGitHub404())
      // 5. Write backlinks.json
      .mockResolvedValueOnce(fakeGitHubPut())
      // 6. Read embeddings.json (upsert re-fetch)
      .mockResolvedValueOnce(
        fakeGitHubContents(JSON.stringify(existingEmbeddings), "emb-sha-2"),
      )
      // 7. Write embeddings.json (upsert write)
      .mockResolvedValueOnce(fakeGitHubPut());

    const response = await POST(
      makeRequest({ content: "A note that matches existing content." }),
    );
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.linkedNotes).toHaveLength(1);
    expect(json.linkedNotes[0].noteId).toBe("20260222T100000-existing1");
    expect(json.linkedNotes[0].similarity).toBe(1);
  });
});
