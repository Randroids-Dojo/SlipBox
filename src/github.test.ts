import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  readFile,
  writeFile,
  readEmbeddingsIndex,
  writeEmbeddingsIndex,
  readBacklinksIndex,
  writeBacklinksIndex,
} from "./github";

// ---------------------------------------------------------------------------
// Environment setup — provide required env vars so config doesn't throw
// ---------------------------------------------------------------------------

beforeEach(() => {
  process.env.GITHUB_TOKEN = "ghp_test_token";
  process.env.PRIVATEBOX_OWNER = "test-owner";
  process.env.PRIVATEBOX_REPO = "test-repo";
});

afterEach(() => {
  delete process.env.GITHUB_TOKEN;
  delete process.env.PRIVATEBOX_OWNER;
  delete process.env.PRIVATEBOX_REPO;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

function fakeContentsResponse(content: string, sha: string = "abc123sha") {
  const encoded = Buffer.from(content, "utf-8").toString("base64");
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: encoded, sha, encoding: "base64" }),
    text: async () => "",
  } as unknown as Response;
}

function fake404Response() {
  return {
    ok: false,
    status: 404,
    json: async () => ({ message: "Not Found" }),
    text: async () => "Not Found",
  } as unknown as Response;
}

function fakeErrorResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  } as unknown as Response;
}

function fakePutResponse(sha: string = "newsha456") {
  return {
    ok: true,
    status: 201,
    json: async () => ({ content: { sha } }),
    text: async () => "",
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// readFile
// ---------------------------------------------------------------------------

describe("readFile", () => {
  it("reads and decodes a file from the GitHub Contents API", async () => {
    fetchSpy.mockResolvedValueOnce(fakeContentsResponse("hello world"));

    const result = await readFile("notes/test.md");

    expect(result).not.toBeNull();
    expect(result!.content).toBe("hello world");
    expect(result!.sha).toBe("abc123sha");

    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.github.com/repos/test-owner/test-repo/contents/notes/test.md",
    );
    expect(options.method).toBe("GET");
    expect((options.headers as Record<string, string>).Authorization).toBe(
      "Bearer ghp_test_token",
    );
  });

  it("returns null for a 404 (file not found)", async () => {
    fetchSpy.mockResolvedValueOnce(fake404Response());

    const result = await readFile("index/embeddings.json");

    expect(result).toBeNull();
  });

  it("throws on non-404 errors", async () => {
    fetchSpy.mockResolvedValueOnce(fakeErrorResponse(500, "Server Error"));

    await expect(readFile("notes/test.md")).rejects.toThrow(
      "GitHub read failed for notes/test.md (500): Server Error",
    );
  });
});

// ---------------------------------------------------------------------------
// writeFile
// ---------------------------------------------------------------------------

describe("writeFile", () => {
  it("creates a new file when no SHA is provided", async () => {
    fetchSpy.mockResolvedValueOnce(fakePutResponse());

    const sha = await writeFile({
      path: "notes/test.md",
      content: "# Test Note\n",
      message: "Add test note",
    });

    expect(sha).toBe("newsha456");

    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.github.com/repos/test-owner/test-repo/contents/notes/test.md",
    );
    expect(options.method).toBe("PUT");

    const body = JSON.parse(options.body as string);
    expect(body.message).toBe("Add test note");
    expect(body.sha).toBeUndefined();
    expect(Buffer.from(body.content, "base64").toString("utf-8")).toBe(
      "# Test Note\n",
    );
  });

  it("updates an existing file when SHA is provided", async () => {
    fetchSpy.mockResolvedValueOnce(fakePutResponse());

    await writeFile({
      path: "index/embeddings.json",
      content: "{}",
      message: "Update index",
      sha: "oldsha789",
    });

    const body = JSON.parse(
      (fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.sha).toBe("oldsha789");
  });

  it("throws on API errors", async () => {
    fetchSpy.mockResolvedValueOnce(fakeErrorResponse(409, "Conflict"));

    await expect(
      writeFile({
        path: "notes/test.md",
        content: "content",
        message: "msg",
        sha: "stale",
      }),
    ).rejects.toThrow("GitHub write failed for notes/test.md (409): Conflict");
  });
});

// ---------------------------------------------------------------------------
// readEmbeddingsIndex
// ---------------------------------------------------------------------------

describe("readEmbeddingsIndex", () => {
  it("returns parsed index when file exists", async () => {
    const data = { embeddings: { "note-1": { noteId: "note-1", vector: [1], model: "m", createdAt: "t" } } };
    fetchSpy.mockResolvedValueOnce(
      fakeContentsResponse(JSON.stringify(data), "emb-sha"),
    );

    const { index, sha } = await readEmbeddingsIndex();

    expect(sha).toBe("emb-sha");
    expect(index.embeddings["note-1"].noteId).toBe("note-1");
  });

  it("returns empty index when file does not exist", async () => {
    fetchSpy.mockResolvedValueOnce(fake404Response());

    const { index, sha } = await readEmbeddingsIndex();

    expect(sha).toBeNull();
    expect(index).toEqual({ embeddings: {} });
  });
});

// ---------------------------------------------------------------------------
// writeEmbeddingsIndex
// ---------------------------------------------------------------------------

describe("writeEmbeddingsIndex", () => {
  it("writes the serialized index", async () => {
    fetchSpy.mockResolvedValueOnce(fakePutResponse("new-emb-sha"));

    const data = { embeddings: {} };
    const sha = await writeEmbeddingsIndex(data, "old-sha");

    expect(sha).toBe("new-emb-sha");

    const body = JSON.parse(
      (fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    const decoded = Buffer.from(body.content, "base64").toString("utf-8");
    expect(JSON.parse(decoded)).toEqual(data);
  });

  it("creates the file when sha is null", async () => {
    fetchSpy.mockResolvedValueOnce(fakePutResponse());

    await writeEmbeddingsIndex({ embeddings: {} }, null);

    const body = JSON.parse(
      (fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.sha).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// readBacklinksIndex / writeBacklinksIndex
// ---------------------------------------------------------------------------

describe("readBacklinksIndex", () => {
  it("returns parsed index when file exists", async () => {
    const data = { links: { "note-1": [{ targetId: "note-2", similarity: 0.9 }] } };
    fetchSpy.mockResolvedValueOnce(
      fakeContentsResponse(JSON.stringify(data), "bl-sha"),
    );

    const { index, sha } = await readBacklinksIndex();

    expect(sha).toBe("bl-sha");
    expect(index.links["note-1"]).toHaveLength(1);
  });

  it("returns empty index when file does not exist", async () => {
    fetchSpy.mockResolvedValueOnce(fake404Response());

    const { index, sha } = await readBacklinksIndex();

    expect(sha).toBeNull();
    expect(index).toEqual({ links: {} });
  });
});

describe("writeBacklinksIndex", () => {
  it("writes the serialized index", async () => {
    fetchSpy.mockResolvedValueOnce(fakePutResponse("new-bl-sha"));

    const sha = await writeBacklinksIndex({ links: {} }, "old-sha");

    expect(sha).toBe("new-bl-sha");
  });
});
