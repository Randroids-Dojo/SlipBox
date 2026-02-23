import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  readFile,
  writeFile,
  readEmbeddingsIndex,
  writeEmbeddingsIndex,
  readBacklinksIndex,
  writeBacklinksIndex,
  updateJsonFileWithRetry,
  upsertEmbeddingWithRetry,
  GitHubConflictError,
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

  it("throws GitHubConflictError on 409 Conflict", async () => {
    fetchSpy.mockResolvedValueOnce(fakeErrorResponse(409, "Conflict"));

    await expect(
      writeFile({
        path: "notes/test.md",
        content: "content",
        message: "msg",
        sha: "stale",
      }),
    ).rejects.toBeInstanceOf(GitHubConflictError);
  });

  it("throws a generic error on other API errors", async () => {
    fetchSpy.mockResolvedValueOnce(fakeErrorResponse(500, "Server Error"));

    await expect(
      writeFile({
        path: "notes/test.md",
        content: "content",
        message: "msg",
      }),
    ).rejects.toThrow("GitHub write failed for notes/test.md (500): Server Error");
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

// ---------------------------------------------------------------------------
// updateJsonFileWithRetry
// ---------------------------------------------------------------------------

type SimpleIndex = { items: Record<string, number> };
const TEST_PATH = "test/data.json";
const emptySimple = (): SimpleIndex => ({ items: {} });

describe("updateJsonFileWithRetry", () => {
  it("GETs then PUTs, and the PUT body contains the mutated content", async () => {
    fetchSpy
      .mockResolvedValueOnce(fakeContentsResponse(JSON.stringify({ items: {} }), "sha-1"))
      .mockResolvedValueOnce(fakePutResponse("sha-2"));

    await updateJsonFileWithRetry<SimpleIndex>(
      TEST_PATH,
      emptySimple,
      (idx) => { idx.items["x"] = 42; },
      "test commit",
    );

    const [getCall, putCall] = fetchSpy.mock.calls as [string, RequestInit][];
    expect((getCall[1] as RequestInit).method).toBe("GET");
    expect((putCall[1] as RequestInit).method).toBe("PUT");

    const putBody = JSON.parse((putCall[1] as RequestInit).body as string);
    const written = JSON.parse(Buffer.from(putBody.content, "base64").toString("utf-8"));
    expect(written.items["x"]).toBe(42);
  });

  it("uses the empty factory when the file does not exist", async () => {
    fetchSpy
      .mockResolvedValueOnce(fake404Response())
      .mockResolvedValueOnce(fakePutResponse("sha-1"));

    await updateJsonFileWithRetry<SimpleIndex>(
      TEST_PATH,
      emptySimple,
      (idx) => { idx.items["new"] = 1; },
      "bootstrap",
    );

    const putBody = JSON.parse(
      (fetchSpy.mock.calls[1] as [string, RequestInit])[1].body as string,
    );
    // No sha field when creating a new file
    expect(putBody.sha).toBeUndefined();
    const written = JSON.parse(Buffer.from(putBody.content, "base64").toString("utf-8"));
    expect(written.items["new"]).toBe(1);
  });

  it("re-fetches on 409 and uses the new SHA on the retry", async () => {
    const initial = JSON.stringify({ items: {} });
    fetchSpy
      .mockResolvedValueOnce(fakeContentsResponse(initial, "sha-1"))         // read #1
      .mockResolvedValueOnce({ ok: false, status: 409, text: async () => "conflict" } as unknown as Response) // write #1 → conflict
      .mockResolvedValueOnce(fakeContentsResponse(initial, "sha-2"))         // read #2
      .mockResolvedValueOnce(fakePutResponse("sha-3"));                      // write #2 → success

    await updateJsonFileWithRetry<SimpleIndex>(TEST_PATH, emptySimple, () => {}, "msg");

    const puts = fetchSpy.mock.calls.filter(
      (c: unknown[]) => (c[1] as RequestInit)?.method === "PUT",
    ) as [string, RequestInit][];
    expect(puts).toHaveLength(2);
    expect(JSON.parse(puts[0][1].body as string).sha).toBe("sha-1");
    expect(JSON.parse(puts[1][1].body as string).sha).toBe("sha-2");
  });

  it("throws immediately on non-conflict errors without retrying", async () => {
    fetchSpy
      .mockResolvedValueOnce(fakeContentsResponse("{\"items\":{}}", "sha-1"))
      .mockResolvedValueOnce(fakeErrorResponse(500, "Internal Server Error"));

    await expect(
      updateJsonFileWithRetry<SimpleIndex>(TEST_PATH, emptySimple, () => {}, "msg"),
    ).rejects.toThrow("GitHub write failed");

    expect(fetchSpy).toHaveBeenCalledTimes(2); // 1 read + 1 write, no retry
  });

  it("throws after exhausting all attempts", async () => {
    for (let i = 0; i < 5; i++) {
      fetchSpy
        .mockResolvedValueOnce(fakeContentsResponse("{\"items\":{}}", `sha-${i}`))
        .mockResolvedValueOnce({ ok: false, status: 409, text: async () => "conflict" } as unknown as Response);
    }

    await expect(
      updateJsonFileWithRetry<SimpleIndex>(TEST_PATH, emptySimple, () => {}, "msg"),
    ).rejects.toThrow(`Failed to update "${TEST_PATH}" after 5 attempts`);

    expect(fetchSpy).toHaveBeenCalledTimes(10); // 5 reads + 5 writes
  });
});

// ---------------------------------------------------------------------------
// upsertEmbeddingWithRetry
// ---------------------------------------------------------------------------

const fakeEmbedding = {
  noteId: "note-1",
  vector: [0.1, 0.2],
  model: "text-embedding-3-small",
  createdAt: "2026-02-23T00:00:00.000Z",
};

describe("upsertEmbeddingWithRetry", () => {
  it("succeeds on the first attempt when there is no conflict", async () => {
    const existingIndex = { embeddings: {} };
    fetchSpy
      .mockResolvedValueOnce(fakeContentsResponse(JSON.stringify(existingIndex), "sha-1")) // read
      .mockResolvedValueOnce(fakePutResponse("sha-2")); // write

    await upsertEmbeddingWithRetry("note-1", fakeEmbedding);

    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Verify the written content contains the embedding
    const putBody = JSON.parse(
      (fetchSpy.mock.calls[1] as [string, RequestInit])[1].body as string,
    );
    const written = JSON.parse(Buffer.from(putBody.content, "base64").toString("utf-8"));
    expect(written.embeddings["note-1"].noteId).toBe("note-1");
  });

  it("retries after a 409 and succeeds on the second attempt", async () => {
    const existingIndex = { embeddings: {} };
    fetchSpy
      .mockResolvedValueOnce(fakeContentsResponse(JSON.stringify(existingIndex), "sha-1")) // read attempt 1
      .mockResolvedValueOnce({ ok: false, status: 409, text: async () => "conflict" } as unknown as Response) // write attempt 1 → conflict
      .mockResolvedValueOnce(fakeContentsResponse(JSON.stringify(existingIndex), "sha-2")) // read attempt 2
      .mockResolvedValueOnce(fakePutResponse("sha-3")); // write attempt 2 → success

    await upsertEmbeddingWithRetry("note-1", fakeEmbedding);

    // 2 reads + 2 writes = 4 fetch calls
    expect(fetchSpy).toHaveBeenCalledTimes(4);

    // Second write used the re-fetched SHA
    const putBody = JSON.parse(
      (fetchSpy.mock.calls[3] as [string, RequestInit])[1].body as string,
    );
    expect(putBody.sha).toBe("sha-2");
  });

  it("is idempotent — overwrites an existing entry without duplicating it", async () => {
    const updatedEmbedding = { ...fakeEmbedding, createdAt: "2026-02-24T00:00:00.000Z" };
    const existingIndex = { embeddings: { "note-1": fakeEmbedding } };

    fetchSpy
      .mockResolvedValueOnce(fakeContentsResponse(JSON.stringify(existingIndex), "sha-1"))
      .mockResolvedValueOnce(fakePutResponse("sha-2"));

    await upsertEmbeddingWithRetry("note-1", updatedEmbedding);

    const putBody = JSON.parse(
      (fetchSpy.mock.calls[1] as [string, RequestInit])[1].body as string,
    );
    const written = JSON.parse(Buffer.from(putBody.content, "base64").toString("utf-8"));
    expect(Object.keys(written.embeddings)).toHaveLength(1);
    expect(written.embeddings["note-1"].createdAt).toBe("2026-02-24T00:00:00.000Z");
  });

  it("throws after exhausting all retry attempts", async () => {
    const existingIndex = { embeddings: {} };
    // 5 read + 5 write (all 409) cycles
    for (let i = 0; i < 5; i++) {
      fetchSpy
        .mockResolvedValueOnce(fakeContentsResponse(JSON.stringify(existingIndex), `sha-${i}`))
        .mockResolvedValueOnce({ ok: false, status: 409, text: async () => "conflict" } as unknown as Response);
    }

    await expect(upsertEmbeddingWithRetry("note-1", fakeEmbedding)).rejects.toThrow(
      `Failed to update "index/embeddings.json" after 5 attempts`,
    );
  });

  it("re-throws immediately on non-conflict errors", async () => {
    const existingIndex = { embeddings: {} };
    fetchSpy
      .mockResolvedValueOnce(fakeContentsResponse(JSON.stringify(existingIndex), "sha-1"))
      .mockResolvedValueOnce(fakeErrorResponse(500, "Internal Server Error"));

    await expect(upsertEmbeddingWithRetry("note-1", fakeEmbedding)).rejects.toThrow(
      "GitHub write failed",
    );

    // Only 1 read + 1 write, no retries
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
