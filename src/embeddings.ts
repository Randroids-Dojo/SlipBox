/**
 * Embedding module — pluggable provider interface + OpenAI implementation.
 *
 * Generates dense vector embeddings from text content. The provider interface
 * allows swapping embedding backends without changing consumer code.
 */

import type { EmbeddingVector, NoteEmbedding } from "@/types";
import type { NoteId } from "@/types";
import { EMBEDDING_MODEL, getOpenAIApiKey } from "./config";

// ---------------------------------------------------------------------------
// Provider Interface
// ---------------------------------------------------------------------------

/** A pluggable embedding provider. */
export interface EmbeddingProvider {
  /** Generate an embedding vector for the given text. */
  embed(text: string): Promise<EmbeddingVector>;
  /** Identifier of the model this provider uses. */
  readonly model: string;
}

// ---------------------------------------------------------------------------
// OpenAI Provider
// ---------------------------------------------------------------------------

/** Response shape from the OpenAI embeddings endpoint. */
interface OpenAIEmbeddingResponse {
  data: { embedding: number[]; index: number }[];
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

/**
 * Create an EmbeddingProvider backed by the OpenAI embeddings API.
 *
 * Uses `fetch` directly (no SDK dependency) to keep the dependency tree minimal.
 */
export function createOpenAIProvider(
  apiKey: string = getOpenAIApiKey(),
  model: string = EMBEDDING_MODEL,
): EmbeddingProvider {
  return {
    model,

    async embed(text: string): Promise<EmbeddingVector> {
      if (!text.trim()) {
        throw new Error("Cannot embed empty text");
      }

      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ input: text, model }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `OpenAI embedding request failed (${response.status}): ${body}`,
        );
      }

      const json = (await response.json()) as OpenAIEmbeddingResponse;

      if (!json.data?.[0]?.embedding) {
        throw new Error("Unexpected OpenAI response: missing embedding data");
      }

      return json.data[0].embedding;
    },
  };
}

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

/**
 * Generate a NoteEmbedding record for a given note using the supplied provider.
 */
export async function embedNote(
  noteId: NoteId,
  content: string,
  provider: EmbeddingProvider,
): Promise<NoteEmbedding> {
  const vector = await provider.embed(content);
  return {
    noteId,
    vector,
    model: provider.model,
    createdAt: new Date().toISOString(),
  };
}
