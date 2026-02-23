/**
 * Centralized configuration for the SlipBox engine.
 *
 * Every tunable lives here. Values fall back to sensible defaults
 * and can be overridden via environment variables.
 *
 * Required environment variables are validated lazily (on first access)
 * so that importing this module in tests does not throw.
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

/**
 * Create a lazy getter that defers validation until first access.
 * The resolved value is cached after the first successful read.
 */
function lazyRequired(name: string): { get value(): string } {
  let cached: string | undefined;
  return {
    get value(): string {
      if (cached === undefined) {
        cached = requireEnv(name);
      }
      return cached;
    },
  };
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

const _slipboxApiKey = lazyRequired("SLIPBOX_API_KEY");

/** Shared secret used to authenticate inbound API requests (validated on first access). */
export function getSlipBoxApiKey(): string {
  return _slipboxApiKey.value;
}

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

/** OpenAI model used for generating embeddings. */
export const EMBEDDING_MODEL = optionalEnv(
  "EMBEDDING_MODEL",
  "text-embedding-3-large",
);

const _openaiApiKey = lazyRequired("OPENAI_API_KEY");

/** OpenAI API key (validated on first access). */
export function getOpenAIApiKey(): string {
  return _openaiApiKey.value;
}

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

const _githubToken = lazyRequired("GITHUB_TOKEN");
const _privateboxOwner = lazyRequired("PRIVATEBOX_OWNER");
const _privateboxRepo = lazyRequired("PRIVATEBOX_REPO");

/** Fine-grained GitHub PAT with Contents read/write on PrivateBox (validated on first access). */
export function getGitHubToken(): string {
  return _githubToken.value;
}

/** GitHub owner (user or org) of the PrivateBox repository (validated on first access). */
export function getPrivateBoxOwner(): string {
  return _privateboxOwner.value;
}

/** PrivateBox repository name (validated on first access). */
export function getPrivateBoxRepo(): string {
  return _privateboxRepo.value;
}

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

/** Path to the clusters index file. */
export const CLUSTERS_INDEX_PATH = optionalEnv(
  "CLUSTERS_INDEX_PATH",
  "index/clusters.json",
);

// ---------------------------------------------------------------------------
// Clustering
// ---------------------------------------------------------------------------

/** Minimum number of clusters for k-means (floor). */
export const MIN_CLUSTERS = optionalNumericEnv("MIN_CLUSTERS", 2);

/** Maximum number of clusters for k-means (ceiling). */
export const MAX_CLUSTERS = optionalNumericEnv("MAX_CLUSTERS", 20);

/** Maximum iterations for k-means convergence. */
export const KMEANS_MAX_ITERATIONS = optionalNumericEnv(
  "KMEANS_MAX_ITERATIONS",
  50,
);

/** Minimum number of notes required to run clustering. */
export const MIN_NOTES_FOR_CLUSTERING = optionalNumericEnv(
  "MIN_NOTES_FOR_CLUSTERING",
  3,
);

// ---------------------------------------------------------------------------
// Tension Detection
// ---------------------------------------------------------------------------

/** Path to the tensions index file. */
export const TENSIONS_INDEX_PATH = optionalEnv(
  "TENSIONS_INDEX_PATH",
  "index/tensions.json",
);

/**
 * Maximum cosine similarity between two notes in the same cluster for
 * them to be flagged as a tension. Pairs above this are considered
 * aligned; pairs below are divergent enough to warrant attention.
 */
export const TENSION_THRESHOLD = optionalNumericEnv(
  "TENSION_THRESHOLD",
  0.72,
);

/** Minimum number of notes required to run tension detection. */
export const MIN_NOTES_FOR_TENSION = optionalNumericEnv(
  "MIN_NOTES_FOR_TENSION",
  4,
);
