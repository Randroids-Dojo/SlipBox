/**
 * Centralized configuration for the SlipBox engine.
 *
 * Every tunable lives here. Values fall back to sensible defaults
 * and can be overridden via environment variables.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

function optionalNumericEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a number, got: ${raw}`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

/** OpenAI model used for generating embeddings. */
export const EMBEDDING_MODEL = optionalEnv(
  "EMBEDDING_MODEL",
  "text-embedding-3-large",
);

/** OpenAI API key. */
export const OPENAI_API_KEY = requireEnv("OPENAI_API_KEY");

// ---------------------------------------------------------------------------
// Similarity
// ---------------------------------------------------------------------------

/** Minimum cosine-similarity score required to create a link between notes. */
export const SIMILARITY_THRESHOLD = optionalNumericEnv(
  "SIMILARITY_THRESHOLD",
  0.82,
);

// ---------------------------------------------------------------------------
// GitHub / PrivateBox
// ---------------------------------------------------------------------------

/** GitHub API base URL (override for GitHub Enterprise). */
export const GITHUB_API_BASE = optionalEnv(
  "GITHUB_API_BASE",
  "https://api.github.com",
);

/** Fine-grained GitHub PAT with Contents read/write on PrivateBox. */
export const GITHUB_TOKEN = requireEnv("GITHUB_TOKEN");

/** GitHub owner (user or org) of the PrivateBox repository. */
export const PRIVATEBOX_OWNER = requireEnv("PRIVATEBOX_OWNER");

/** PrivateBox repository name. */
export const PRIVATEBOX_REPO = requireEnv("PRIVATEBOX_REPO");

// ---------------------------------------------------------------------------
// PrivateBox paths (relative to repo root)
// ---------------------------------------------------------------------------

/** Directory where atomic note files are stored. */
export const NOTES_DIR = optionalEnv("NOTES_DIR", "notes");

/** Path to the embeddings index file. */
export const EMBEDDINGS_INDEX_PATH = optionalEnv(
  "EMBEDDINGS_INDEX_PATH",
  "index/embeddings.json",
);

/** Path to the backlinks index file. */
export const BACKLINKS_INDEX_PATH = optionalEnv(
  "BACKLINKS_INDEX_PATH",
  "index/backlinks.json",
);
