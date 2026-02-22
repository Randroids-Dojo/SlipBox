# Next Priorities

Implementation roadmap for SlipBox Phase 1: manual note ingestion + auto-linking.

---

## Current Status

**Completed:** All Phase 1 priorities (1-10). The full note ingestion and auto-linking pipeline is implemented. The GitHub module reads/writes PrivateBox files via the Contents API with SHA tracking and graceful 404 handling for bootstrapping. The graph module manages bidirectional backlinks with add/remove/rebuild operations. The `POST /api/add-note` endpoint runs the complete pipeline: create note → embed → similarity pass → update links → commit. The `POST /api/link-pass` endpoint batch-recomputes all similarity links across the full embeddings index. 82 unit and integration tests pass.

**Phase 1 is complete.** The deferred items below are targets for Phase 2+.

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

## Deferred (Phase 2+)

These are documented in Plan.md but not targets for Phase 1:

- `/api/cluster-pass` — cluster embedding space, create meta-notes
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
