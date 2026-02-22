import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { POST } from "./route";

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

function fakeGitHubPut(sha: string = "newsha") {
  return {
    ok: true,
    status: 201,
    json: async () => ({ content: { sha } }),
    text: async () => "",
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(): Request {
  return new Request("http://localhost/api/link-pass", {
    method: "POST",
    headers: { Authorization: `Bearer ${TEST_API_KEY}` },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/link-pass", () => {
  it("returns zero links when no notes exist", async () => {
    fetchSpy
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

    fetchSpy
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
    const writeCalls = fetchSpy.mock.calls.filter(
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

    fetchSpy
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
