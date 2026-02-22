# Next Priorities

Implementation roadmap for SlipBox Phase 1: manual note ingestion + auto-linking.

---

## Current Status

**Completed:** Priorities 1-6 (scaffolding + types + config + note module + embedding module + similarity module). The Next.js app is deployed on Vercel with a health-check endpoint. All tunables are centralized in `src/config.ts` with lazy validation for required env vars. The note module handles ID generation, content normalization, validation, and serialization. The embedding module provides a pluggable `EmbeddingProvider` interface with an OpenAI implementation. The similarity module computes cosine similarity and finds threshold-based matches. 45 unit tests pass.

**Next up:** Priorities 7-8 add the persistence and graph layers:

| Priority | Module | What it does |
|----------|--------|-------------|
| **7** | `src/github.ts` | Read/write PrivateBox files via GitHub Contents API |
| **8** | `src/graph.ts` | Bidirectional backlink management + serialization |

Finally, Priorities 9-10 wire everything into API routes:

| Priority | Module | What it does |
|----------|--------|-------------|
| **9** | `app/api/add-note/route.ts` | Full pipeline: create note, embed, link, commit |
| **10** | `app/api/link-pass/route.ts` | Batch recompute all similarity links |

**Recommended next move:** Start with Priority 7 (GitHub Integration) — it depends on types and config, both of which are complete.

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

## Priority 7 — GitHub Integration

Read and write PrivateBox contents via GitHub API.

- [ ] `src/github.ts` — Read file from repo (with SHA tracking for updates)
- [ ] Write/update file in repo (commit via Contents API)
- [ ] Read `embeddings.json` and `backlinks.json` index files
- [ ] Write updated index files back
- [ ] Handle file-not-found gracefully (first note bootstraps the repo)

**Done when:** Can round-trip a file to a test GitHub repo.

---

## Priority 8 — Graph Module

Manage the backlink structure.

- [ ] `src/graph.ts` — Add bidirectional link between two note IDs
- [ ] Remove link
- [ ] Serialize/deserialize `backlinks.json`

**Done when:** Backlink graph can be built, modified, and persisted.

---

## Priority 9 — POST /api/add-note

The first real endpoint. Ties everything together.

- [ ] `app/api/add-note/route.ts`
- [ ] Accept `{ "content": "..." }` POST body
- [ ] Pipeline: create note → embed → fetch index → similarity pass → update links → commit all changes
- [ ] Return `{ "noteId": "...", "linkedNotes": [...] }`
- [ ] Integration test with mocked GitHub + OpenAI

**Done when:** A POST request adds a note to PrivateBox with correct backlinks.

---

## Priority 10 — POST /api/link-pass

Batch recomputation of all links.

- [ ] `app/api/link-pass/route.ts`
- [ ] Fetch all embeddings, recompute full similarity matrix
- [ ] Rebuild `backlinks.json`
- [ ] Commit updated index

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
