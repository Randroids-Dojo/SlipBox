# Next Priorities

Implementation roadmap for SlipBox.

---

## Current Status

**Completed:** All Phase 1 priorities (1-10) plus API authentication, and Phase 2 Priority 11 (cluster-pass). The full note ingestion, auto-linking, and semantic clustering pipeline is implemented. The GitHub module reads/writes PrivateBox files via the Contents API with SHA tracking and graceful 404 handling for bootstrapping. The graph module manages bidirectional backlinks with add/remove/rebuild operations. The `POST /api/add-note` endpoint runs the complete pipeline: create note → embed → similarity pass → update links → commit. The `POST /api/link-pass` endpoint batch-recomputes all similarity links across the full embeddings index. The `POST /api/cluster-pass` endpoint clusters the embedding space using k-means and commits cluster metadata to PrivateBox. Inbound API requests are authenticated via a shared Bearer token (`SLIPBOX_API_KEY`). 117 unit and integration tests pass.

**Phase 1 is complete.** Phase 2 is in progress.

---

## Priority 1 — Project Scaffolding ✓

Set up the runnable skeleton before writing any logic.

- [x] Initialize Next.js project with TypeScript (App Router)
- [x] Configure Vercel deployment target
- [x] Add environment variable schema (OpenAI key, GitHub token, PrivateBox repo)
- [x] Add `.env.example` with required variables documented
- [x] Set up linting and formatting (ESLint, Prettier)

**Done when:** `npm run dev` starts and a health-check route responds.

---

## Priority 2 — Core Types ✓

Define the data shapes everything else builds on.

- [x] `types/note.ts` — Note ID, content, metadata, timestamps, links
- [x] `types/embedding.ts` — Embedding vector, note reference, model identifier

**Done when:** Types compile and are importable from `/types`.

---

## Priority 3 — Config Module ✓

Centralize tunables so nothing is hardcoded in logic.

- [x] `src/config.ts` — Similarity threshold (0.82), embedding model name, PrivateBox repo coordinates, GitHub API base URL

**Done when:** Config values are importable and overridable via env vars.

---

## Priority 4 — Note Module ✓

Handle note creation independent of storage.

- [x] `src/note.ts` — Generate unique note ID (timestamp + hash)
- [x] Normalize content to atomic note format (frontmatter + body)
- [x] Validate note structure
- [x] Serialize note to markdown with YAML frontmatter
- [x] Unit tests (21 tests via vitest)

**Done when:** Given raw content string, produces a well-formed note object.

---

## Priority 5 — Embedding Module ✓

Generate embeddings with a pluggable provider interface.

- [x] `src/embeddings.ts` — `EmbeddingProvider` interface (`embed(text: string): Promise<number[]>`)
- [x] OpenAI implementation using `text-embedding-3-large` (direct `fetch`, no SDK dependency)
- [x] `embedNote()` convenience helper to produce `NoteEmbedding` records
- [x] Unit tests with mocked OpenAI responses (8 tests via vitest)

**Done when:** Can generate an embedding vector from a string, and provider is swappable.

---

## Priority 6 — Similarity Module ✓

Pure math, no external dependencies.

- [x] `src/similarity.ts` — Cosine similarity function
- [x] `findMatches()` — find all notes above threshold given a target embedding and an embeddings index
- [x] `matchesToLinks()` — convert similarity matches to `NoteLink` objects
- [x] Unit tests with known vectors (16 tests via vitest)

**Done when:** Given two vectors, returns correct cosine similarity. Given an index, returns ranked matches above threshold.

---

## Priority 7 — GitHub Integration ✓

Read and write PrivateBox contents via GitHub API.

- [x] `src/github.ts` — Read file from repo (with SHA tracking for updates)
- [x] Write/update file in repo (commit via Contents API)
- [x] Read `embeddings.json` and `backlinks.json` index files
- [x] Write updated index files back
- [x] Handle file-not-found gracefully (first note bootstraps the repo)
- [x] Unit tests with mocked GitHub API (13 tests via vitest)

**Done when:** Can round-trip a file to a test GitHub repo.

---

## Priority 8 — Graph Module ✓

Manage the backlink structure.

- [x] `src/graph.ts` — Add bidirectional link between two note IDs
- [x] Remove link
- [x] Serialize/deserialize `backlinks.json`
- [x] `rebuildBacklinks()` — rebuild full index from link pairs (used by link-pass)
- [x] `types/graph.ts` — `BacklinksIndex` type definition
- [x] Unit tests (17 tests via vitest)

**Done when:** Backlink graph can be built, modified, and persisted.

---

## Priority 9 — POST /api/add-note ✓

The first real endpoint. Ties everything together.

- [x] `app/api/add-note/route.ts`
- [x] Accept `{ "content": "..." }` POST body
- [x] Pipeline: create note → embed → fetch index → similarity pass → update links → commit all changes
- [x] Return `{ "noteId": "...", "linkedNotes": [...] }`
- [x] Integration test with mocked GitHub + OpenAI (4 tests via vitest)

**Done when:** A POST request adds a note to PrivateBox with correct backlinks.

---

## Priority 10 — POST /api/link-pass ✓

Batch recomputation of all links.

- [x] `app/api/link-pass/route.ts`
- [x] Fetch all embeddings, recompute full similarity matrix
- [x] Rebuild `backlinks.json`
- [x] Commit updated index
- [x] Integration test with mocked GitHub (3 tests via vitest)

**Done when:** Calling link-pass produces a correct backlink graph for all existing notes.

---

## API Authentication ✓

Protect inbound endpoints so only authorized clients (e.g. your ChatGPT) can call them.

- [x] `SLIPBOX_API_KEY` environment variable in config (lazy-validated)
- [x] `src/auth.ts` — `verifyAuth()` checks `Authorization: Bearer <key>` header
- [x] Constant-time token comparison to prevent timing attacks
- [x] Clear error responses: 401 for missing/malformed header, 403 for wrong key
- [x] Unit tests (8 tests via vitest)

**Done when:** Requests without a valid Bearer token are rejected before reaching any business logic.

---

## Phase 2 — Clustering & Tension Detection

---

## Priority 11 — Cluster Module ✓

Pure k-means clustering of the embedding space, no external dependencies.

- [x] `types/cluster.ts` — `Cluster`, `ClustersIndex` type definitions
- [x] `src/cluster.ts` — k-means++ initialization, k-means algorithm, automatic K selection via sqrt(n/2) heuristic
- [x] `squaredDistance()` — Euclidean distance for assignment step
- [x] `chooseK()` — Automatic cluster count selection bounded by configurable min/max
- [x] `clusterEmbeddings()` — High-level function: embeddings index → clusters index
- [x] Config tunables: `CLUSTERS_INDEX_PATH`, `MIN_CLUSTERS`, `MAX_CLUSTERS`, `KMEANS_MAX_ITERATIONS`, `MIN_NOTES_FOR_CLUSTERING`
- [x] Unit tests (22 tests via vitest)

**Done when:** Given an embeddings index, produces semantically grouped clusters with centroids.

---

## Priority 12 — POST /api/cluster-pass ✓

Cluster the embedding space and persist results.

- [x] `app/api/cluster-pass/route.ts`
- [x] Fetch all embeddings from PrivateBox
- [x] Run k-means clustering (automatic K or user-specified `{ "k": N }`)
- [x] Commit `clusters.json` to PrivateBox
- [x] Return cluster summary: count, sizes, and note assignments
- [x] GitHub integration: `readClustersIndex()`, `writeClustersIndex()` helpers
- [x] Integration tests with mocked GitHub (5 tests via vitest)

**Done when:** Calling cluster-pass produces and persists a valid clusters index.

---

## Deferred (Phase 2+)

These are documented in Plan.md but not yet implemented:

- `/api/tension-pass` — detect semantic contradictions
- Nightly scheduled passes
- Emergent theme detection
- Theory evolution engine

---

## Guiding Constraints

- No user data in this repo. Ever.
- No persistent database — GitHub is the database.
- No automatic note rewriting.
- Every link must be deterministic and transparent.
- Keep dependencies minimal.
