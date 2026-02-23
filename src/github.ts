/**
 * GitHub integration — read/write PrivateBox files via the GitHub Contents API.
 *
 * All persistence goes through this module. GitHub acts as the database:
 * notes are markdown files, and indexes (embeddings.json, backlinks.json)
 * are JSON files committed alongside them.
 */

import {
  type BacklinksIndex,
  type ClustersIndex,
  type EmbeddingsIndex,
  type NoteEmbedding,
  type NoteId,
  type TensionsIndex,
  emptyBacklinksIndex,
  emptyClustersIndex,
  emptyEmbeddingsIndex,
  emptyTensionsIndex,
} from "@/types";
import {
  BACKLINKS_INDEX_PATH,
  CLUSTERS_INDEX_PATH,
  EMBEDDINGS_INDEX_PATH,
  TENSIONS_INDEX_PATH,
  GITHUB_API_BASE,
  getGitHubToken,
  getPrivateBoxOwner,
  getPrivateBoxRepo,
} from "./config";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when GitHub returns 409 Conflict, meaning the SHA provided to a PUT
 * was stale — another write happened between the read and write.
 */
export class GitHubConflictError extends Error {
  constructor(path: string) {
    super(`GitHub conflict (stale SHA) for ${path}`);
    this.name = "GitHubConflictError";
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of reading a file from the GitHub Contents API. */
export interface GitHubFile {
  /** Decoded UTF-8 content of the file. */
  content: string;
  /** The blob SHA, required when updating an existing file. */
  sha: string;
}

/** Options for writing a file to PrivateBox. */
export interface WriteFileOptions {
  /** Repo-relative file path (e.g. "notes/20260222T153045-abc.md"). */
  path: string;
  /** UTF-8 content to write. */
  content: string;
  /** Commit message. */
  message: string;
  /** SHA of the existing file (required for updates, omit for creation). */
  sha?: string;
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

/** Build the Contents API URL for a given path. */
function contentsUrl(path: string): string {
  const owner = getPrivateBoxOwner();
  const repo = getPrivateBoxRepo();
  return `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${path}`;
}

/** Common headers for GitHub API requests. */
function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${getGitHubToken()}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
  };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read a file from PrivateBox.
 *
 * Returns the decoded content and SHA, or `null` if the file does not exist
 * (HTTP 404). This allows the first note to bootstrap the repository
 * without requiring pre-existing index files.
 */
export async function readFile(path: string): Promise<GitHubFile | null> {
  const response = await fetch(contentsUrl(path), {
    method: "GET",
    headers: headers(),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub read failed for ${path} (${response.status}): ${body}`,
    );
  }

  const json = (await response.json()) as {
    content: string;
    sha: string;
    encoding: string;
  };

  if (json.encoding !== "base64") {
    throw new Error(`Unexpected encoding for ${path}: ${json.encoding}`);
  }

  const content = Buffer.from(json.content, "base64").toString("utf-8");
  return { content, sha: json.sha };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Write (create or update) a file in PrivateBox.
 *
 * Uses the GitHub Contents API PUT endpoint. When updating an existing file,
 * the `sha` option must be provided to avoid conflicts.
 *
 * Returns the new blob SHA after the commit.
 */
export async function writeFile(options: WriteFileOptions): Promise<string> {
  const body: Record<string, string> = {
    message: options.message,
    content: Buffer.from(options.content, "utf-8").toString("base64"),
  };

  if (options.sha) {
    body.sha = options.sha;
  }

  const response = await fetch(contentsUrl(options.path), {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    if (response.status === 409) {
      throw new GitHubConflictError(options.path);
    }
    const text = await response.text();
    throw new Error(
      `GitHub write failed for ${options.path} (${response.status}): ${text}`,
    );
  }

  const json = (await response.json()) as { content: { sha: string } };
  return json.content.sha;
}

// ---------------------------------------------------------------------------
// Index helpers
// ---------------------------------------------------------------------------

/**
 * Read the embeddings index from PrivateBox.
 * Returns an empty index if the file does not yet exist.
 */
export async function readEmbeddingsIndex(): Promise<{
  index: EmbeddingsIndex;
  sha: string | null;
}> {
  const file = await readFile(EMBEDDINGS_INDEX_PATH);
  if (!file) {
    return { index: emptyEmbeddingsIndex(), sha: null };
  }
  return { index: JSON.parse(file.content) as EmbeddingsIndex, sha: file.sha };
}

/**
 * Write the embeddings index to PrivateBox.
 */
export async function writeEmbeddingsIndex(
  index: EmbeddingsIndex,
  sha: string | null,
  message: string = "Update embeddings index",
): Promise<string> {
  return writeFile({
    path: EMBEDDINGS_INDEX_PATH,
    content: JSON.stringify(index, null, 2) + "\n",
    message,
    sha: sha ?? undefined,
  });
}

/**
 * Read the backlinks index from PrivateBox.
 * Returns an empty index if the file does not yet exist.
 */
export async function readBacklinksIndex(): Promise<{
  index: BacklinksIndex;
  sha: string | null;
}> {
  const file = await readFile(BACKLINKS_INDEX_PATH);
  if (!file) {
    return { index: emptyBacklinksIndex(), sha: null };
  }
  return { index: JSON.parse(file.content) as BacklinksIndex, sha: file.sha };
}

/**
 * Write the backlinks index to PrivateBox.
 */
export async function writeBacklinksIndex(
  index: BacklinksIndex,
  sha: string | null,
  message: string = "Update backlinks index",
): Promise<string> {
  return writeFile({
    path: BACKLINKS_INDEX_PATH,
    content: JSON.stringify(index, null, 2) + "\n",
    message,
    sha: sha ?? undefined,
  });
}

/**
 * Read the clusters index from PrivateBox.
 * Returns an empty index if the file does not yet exist.
 */
export async function readClustersIndex(): Promise<{
  index: ClustersIndex;
  sha: string | null;
}> {
  const file = await readFile(CLUSTERS_INDEX_PATH);
  if (!file) {
    return { index: emptyClustersIndex(), sha: null };
  }
  return { index: JSON.parse(file.content) as ClustersIndex, sha: file.sha };
}

/**
 * Write the clusters index to PrivateBox.
 */
export async function writeClustersIndex(
  index: ClustersIndex,
  sha: string | null,
  message: string = "Update clusters index",
): Promise<string> {
  return writeFile({
    path: CLUSTERS_INDEX_PATH,
    content: JSON.stringify(index, null, 2) + "\n",
    message,
    sha: sha ?? undefined,
  });
}

/**
 * Read the tensions index from PrivateBox.
 * Returns an empty index if the file does not yet exist.
 */
export async function readTensionsIndex(): Promise<{
  index: TensionsIndex;
  sha: string | null;
}> {
  const file = await readFile(TENSIONS_INDEX_PATH);
  if (!file) {
    return { index: emptyTensionsIndex(), sha: null };
  }
  return { index: JSON.parse(file.content) as TensionsIndex, sha: file.sha };
}

/**
 * Write the tensions index to PrivateBox.
 */
export async function writeTensionsIndex(
  index: TensionsIndex,
  sha: string | null,
  message: string = "Update tensions index",
): Promise<string> {
  return writeFile({
    path: TENSIONS_INDEX_PATH,
    content: JSON.stringify(index, null, 2) + "\n",
    message,
    sha: sha ?? undefined,
  });
}

// ---------------------------------------------------------------------------
// Optimistic-concurrency index update
// ---------------------------------------------------------------------------

const MAX_UPDATE_ATTEMPTS = 5;

/**
 * Atomically read-mutate-write any JSON index file with optimistic concurrency.
 *
 * Re-fetches the file from GitHub before every write attempt, then retries on
 * 409 Conflict. Non-conflict errors (auth, network, 5xx) are rethrown
 * immediately without retrying.
 *
 * @param path    - Repo-relative path to the JSON file (e.g. "index/embeddings.json").
 * @param empty   - Factory that returns an empty index when the file does not yet exist.
 * @param mutate  - Applies the desired change to the parsed index in place.
 * @param message - Git commit message used for the write.
 */
export async function updateJsonFileWithRetry<T>(
  path: string,
  empty: () => T,
  mutate: (index: T) => void,
  message: string,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_UPDATE_ATTEMPTS; attempt++) {
    const file = await readFile(path);
    const index: T = file ? (JSON.parse(file.content) as T) : empty();
    const sha = file?.sha ?? null;

    mutate(index);

    try {
      console.log(
        JSON.stringify({ event: "index_update_attempt", attempt, path }),
      );
      await writeFile({
        path,
        content: JSON.stringify(index, null, 2) + "\n",
        message,
        sha: sha ?? undefined,
      });
      console.log(
        JSON.stringify({ event: "index_update_success", attempt, path }),
      );
      return;
    } catch (err) {
      if (!(err instanceof GitHubConflictError)) {
        throw err;
      }
      if (attempt < MAX_UPDATE_ATTEMPTS) {
        const delayMs = 50 + Math.floor(Math.random() * 100);
        console.log(
          JSON.stringify({
            event: "index_update_conflict",
            attempt,
            path,
            retryAfterMs: delayMs,
          }),
        );
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw new Error(
    `Failed to update "${path}" after ${MAX_UPDATE_ATTEMPTS} attempts`,
  );
}

/**
 * Read a note file from PrivateBox by note ID.
 *
 * Returns the raw markdown content, or `null` if the note does not exist.
 */
export async function readNote(
  noteId: NoteId,
  notesDir: string,
): Promise<string | null> {
  const file = await readFile(`${notesDir}/${noteId}.md`);
  return file ? file.content : null;
}

/**
 * Atomically upsert a single embedding entry in the embeddings index.
 * Thin wrapper around updateJsonFileWithRetry.
 */
export async function upsertEmbeddingWithRetry(
  noteId: NoteId,
  embedding: NoteEmbedding,
  message: string = `Update embeddings: add ${noteId}`,
): Promise<void> {
  return updateJsonFileWithRetry<EmbeddingsIndex>(
    EMBEDDINGS_INDEX_PATH,
    emptyEmbeddingsIndex,
    (index) => { index.embeddings[noteId] = embedding; },
    message,
  );
}
