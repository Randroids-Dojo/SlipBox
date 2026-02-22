import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  createOpenAIProvider,
  embedNote,
  type EmbeddingProvider,
} from "./embeddings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A fake embedding vector for testing. */
const FAKE_VECTOR = [0.1, 0.2, 0.3, 0.4, 0.5];

/** Build a successful OpenAI-shaped response. */
function fakeOpenAIResponse(embedding: number[] = FAKE_VECTOR) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: [{ embedding, index: 0 }],
      model: "text-embedding-3-large",
      usage: { prompt_tokens: 5, total_tokens: 5 },
    }),
    text: async () => "",
  } as unknown as Response;
}

/** Build a failed response. */
function fakeErrorResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Stub provider (no network)
// ---------------------------------------------------------------------------

/** Create a deterministic in-memory provider for tests. */
function stubProvider(vector: number[] = FAKE_VECTOR): EmbeddingProvider {
  return {
    model: "stub-model",
    async embed(text: string) {
      if (!text.trim()) throw new Error("Cannot embed empty text");
      return vector;
    },
  };
}

// ---------------------------------------------------------------------------
// createOpenAIProvider
// ---------------------------------------------------------------------------

describe("createOpenAIProvider", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns an EmbeddingProvider with the specified model", () => {
    const provider = createOpenAIProvider("sk-test", "text-embedding-3-large");
    expect(provider.model).toBe("text-embedding-3-large");
  });

  it("calls the OpenAI embeddings endpoint and returns the vector", async () => {
    fetchSpy.mockResolvedValueOnce(fakeOpenAIResponse());

    const provider = createOpenAIProvider("sk-test", "text-embedding-3-large");
    const result = await provider.embed("hello world");

    expect(result).toEqual(FAKE_VECTOR);
    expect(fetchSpy).toHaveBeenCalledOnce();

    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/embeddings");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer sk-test",
        "Content-Type": "application/json",
      }),
    );

    const body = JSON.parse(options.body as string);
    expect(body.input).toBe("hello world");
    expect(body.model).toBe("text-embedding-3-large");
  });

  it("throws on empty text", async () => {
    const provider = createOpenAIProvider("sk-test");
    await expect(provider.embed("   ")).rejects.toThrow(
      "Cannot embed empty text",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws on non-OK HTTP response", async () => {
    fetchSpy.mockResolvedValueOnce(
      fakeErrorResponse(401, "Invalid API key"),
    );

    const provider = createOpenAIProvider("sk-bad");
    await expect(provider.embed("test")).rejects.toThrow(
      "OpenAI embedding request failed (401): Invalid API key",
    );
  });

  it("throws when response data is malformed", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
      text: async () => "",
    } as unknown as Response);

    const provider = createOpenAIProvider("sk-test");
    await expect(provider.embed("test")).rejects.toThrow(
      "Unexpected OpenAI response: missing embedding data",
    );
  });
});

// ---------------------------------------------------------------------------
// embedNote
// ---------------------------------------------------------------------------

describe("embedNote", () => {
  it("produces a NoteEmbedding with correct fields", async () => {
    const provider = stubProvider();
    const result = await embedNote("20260222T153045-abcd1234", "An atomic idea.", provider);

    expect(result.noteId).toBe("20260222T153045-abcd1234");
    expect(result.vector).toEqual(FAKE_VECTOR);
    expect(result.model).toBe("stub-model");
    expect(result.createdAt).toBeTruthy();
    // Verify ISO-8601 format
    expect(new Date(result.createdAt).toISOString()).toBe(result.createdAt);
  });

  it("passes content to the provider's embed method", async () => {
    const embedSpy = vi.fn().mockResolvedValue(FAKE_VECTOR);
    const provider: EmbeddingProvider = {
      model: "spy-model",
      embed: embedSpy,
    };

    await embedNote("20260222T153045-abcd1234", "Specific content here", provider);
    expect(embedSpy).toHaveBeenCalledWith("Specific content here");
  });

  it("propagates provider errors", async () => {
    const provider: EmbeddingProvider = {
      model: "fail-model",
      async embed() {
        throw new Error("Provider exploded");
      },
    };

    await expect(
      embedNote("20260222T153045-abcd1234", "test", provider),
    ).rejects.toThrow("Provider exploded");
  });
});
