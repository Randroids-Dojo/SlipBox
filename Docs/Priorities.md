# Next Priorities

Implementation roadmap for SlipBox.

---

## Current Status

**Completed:** All Phase 1 priorities (1-10) plus API authentication, Phase 2 Priorities 11-14 (cluster module, cluster-pass, tension module, tension-pass), Phase 3 Priorities 15-16 (nightly scheduled passes, GET /api/theme-data), and Phase 4 Priority 17 (relation types + RelationsIndex). The full note ingestion, auto-linking, semantic clustering, tension detection, and nightly automation pipeline is implemented. The relation module defines typed semantic edges (`supports`, `contradicts`, `refines`, `is-example-of`, `contrasts-with`) with canonical pair keying, upsert semantics, per-note filtering, and serialization. `readRelationsIndex()` and `writeRelationsIndex()` GitHub helpers and `RELATIONS_INDEX_PATH` config are in place. 181 unit and integration tests pass.

**Phase 1 is complete. Phase 2 is complete. Phase 3 is complete. Phase 4 is in progress.**

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

## Priority 13 — Tension Module ✓

Pure embedding-space tension detection, no external dependencies.

- [x] `types/tension.ts` — `Tension`, `TensionsIndex` type definitions
- [x] `src/tension.ts` — `detectTensions()` scans clusters for divergent note pairs
- [x] Pairwise cosine similarity within each cluster; pairs below threshold are flagged
- [x] Canonical note ordering (smaller ID first) in tension records
- [x] Config tunables: `TENSIONS_INDEX_PATH`, `TENSION_THRESHOLD`, `MIN_NOTES_FOR_TENSION`
- [x] Unit tests (13 tests via vitest)

**Done when:** Given embeddings and clusters indexes, produces tension records for divergent pairs.

---

## Priority 14 — POST /api/tension-pass ✓

Detect tensions and persist results.

- [x] `app/api/tension-pass/route.ts`
- [x] Fetch embeddings and clusters from PrivateBox
- [x] Run tension detection across all clusters
- [x] Commit `tensions.json` to PrivateBox
- [x] Return tension summary: count and individual tension records with similarity scores
- [x] GitHub integration: `readTensionsIndex()`, `writeTensionsIndex()` helpers
- [x] Integration tests with mocked GitHub (5 tests via vitest)

**Done when:** Calling tension-pass produces and persists a valid tensions index.

---

---

## Phase 3 — Theme Synthesis

---

## Priority 15 — Nightly Scheduled Passes ✓

Automate the link, cluster, and tension passes via GitHub Actions.

- [x] `.github/workflows/nightly-passes.yml` — runs at 3 AM UTC daily
- [x] Jobs chained: link-pass → cluster-pass → tension-pass
- [x] `workflow_dispatch` for manual runs
- [x] `SLIPBOX_URL` and `SLIPBOX_API_KEY` as GitHub Actions secrets

**Done when:** Passes run automatically each night without manual invocation.

---

## Priority 16 — GET /api/theme-data ✓

Expose a read endpoint so local LLM agents can fetch everything needed to
synthesize meta-notes without making expensive OpenAI chat API calls.

- [x] `app/api/theme-data/route.ts`
- [x] Fetches clusters and tensions indexes in parallel
- [x] Fetches full note content for every note in every cluster (in parallel)
- [x] Parses frontmatter to extract title and body (`parseNoteContent` in `src/note.ts`)
- [x] `readNote()` helper in `src/github.ts`
- [x] Returns `{ clusters, tensions, clusterCount, noteCount, tensionCount, computedAt }`
- [x] Each cluster entry includes `notes: { [noteId]: { title?, body } }`
- [x] Integration tests (5 tests via vitest)
- [x] Meta-notes submitted back via existing `POST /api/add-note` with `type: meta` frontmatter tag

**Done when:** A local LLM agent can GET theme-data, synthesize cluster summaries,
and POST them back as tagged meta-notes without any OpenAI chat API calls.

---

---

## Phase 4 — Knowledge Evolution & Theory Discovery

Phase 4 turns SlipBox from a structured repository into a self-evolving cognitive
space: typed semantic edges, research hypothesis generation, staleness detection,
an evolution timeline, structural gap analysis, advisory note refinements, and an
interactive graph UI.

### Architectural Decisions

**A. LLM synthesis pattern stays the same.** GET-endpoint exposes structured data →
local LLM agent reasons over it → POST-endpoint writes results back. No OpenAI Chat
API calls server-side. Applies to relation typing, hypothesis generation, and
refinement suggestions.

**B. New index files in PrivateBox** (same pattern as existing indexes):
- `index/relations.json` — typed semantic edges
- `index/decay.json` — staleness scores
- `index/refinements.json` — LLM-suggested note edits (advisory only)
- `index/explorations.json` — structural gap suggestions
- `index/snapshots.json` — append-only evolution timeline

**C. Hard constraint preserved:** No automatic note rewriting. Refinements are
suggestions only. Hypotheses are submitted as typed meta-notes via the existing
`POST /api/add-note` (`type: hypothesis` in frontmatter).

---

## Priority 17 — Relation Types + RelationsIndex ✓

Define the semantic edge vocabulary and the index that stores typed links.

- [x] `types/relation.ts` — `RelationType`, `TypedLink`, `RelationsIndex` type definitions
- [x] `RelationType`: `'supports' | 'contradicts' | 'refines' | 'is-example-of' | 'contrasts-with'`
- [x] `TypedLink` — noteA, noteB, relationType, reason (LLM annotation, ~1 sentence), similarity, classifiedAt
- [x] `RelationsIndex` — keyed by `${noteA}:${noteB}` in canonical (smaller ID first) order
- [x] `src/relation.ts` — `canonicalKey()`, `upsertRelation()`, `getRelationsForNote()`, serialize/deserialize, `emptyRelationsIndex()`
- [x] `readRelationsIndex()`, `writeRelationsIndex()` GitHub helpers in `src/github.ts`
- [x] Unit tests (27 via vitest) — serialization, canonical ordering, upsert semantics, filtering

**Done when:** Types compile, module functions pass unit tests, GitHub helpers exist.

---

## Priority 18 — GET /api/link-data

Expose linked note pairs with full note content for local LLM relation classification.

- [ ] `app/api/link-data/route.ts`
- [ ] Fetch backlinks + relations + note contents in parallel
- [ ] Build pair list from backlinks, join existing relation types
- [ ] Return `{ pairs[], pairCount, classifiedCount, computedAt }` — each pair includes noteA/noteB content + existing relation if any
- [ ] `?unclassifiedOnly=true` query param to filter to unclassified pairs (incremental runs)
- [ ] Integration tests (5+ via vitest)

**Done when:** GET returns correct pair list; unclassifiedOnly filter works; note content is included.

---

## Priority 19 — POST /api/relations

Accept typed relation records from a local LLM agent and persist them.

- [ ] `app/api/relations/route.ts`
- [ ] Accept `{ relations: [{ noteA, noteB, relationType, reason }] }`
- [ ] Read current relations index → upsert each record (attach similarity from backlinks, classifiedAt timestamp) → commit
- [ ] Validate: reject unknown relation types; reject pairs not in backlinks index
- [ ] Return `{ updated, total }`
- [ ] Integration tests (5+ via vitest)

**Done when:** LLM agent can classify pairs from link-data and POST results; relations.json is updated correctly.

---

## Priority 20 — Decay Module + POST /api/decay-pass

Pure-math staleness detection — no LLM, no external dependencies. Same pattern as tension detection.

- [ ] `types/decay.ts` — `DecayRecord`, `DecayReason`, `DecayIndex` type definitions
- [ ] `DecayReason`: `'no-links' | 'low-link-density' | 'cluster-outlier' | 'no-cluster'`
- [ ] `src/decay.ts` — `computeDecay(embeddingsIndex, backlinksIndex, clustersIndex, config)` → `DecayIndex`
- [ ] Scoring: `+0.4` no-links, `+0.2` low-link-density (< 2 links), `+0.3` cluster-outlier (similarity to centroid < threshold), `+0.1` no-cluster; capped at 1.0
- [ ] Config tunables: `DECAY_INDEX_PATH`, `CLUSTER_OUTLIER_THRESHOLD` (default 0.70), `DECAY_SCORE_THRESHOLD` (default 0.3 — minimum score to include)
- [ ] `app/api/decay-pass/route.ts` — fetch indexes → run decay → commit `decay.json` → return `{ staleCount, records[] }`
- [ ] `readDecayIndex()`, `writeDecayIndex()` GitHub helpers
- [ ] Unit tests (25+ via vitest) — each scoring component; integration tests (4+)

**Done when:** decay-pass detects isolated, low-link, and outlier notes correctly; commits decay.json.

---

## Priority 21 — GET /api/hypothesis-data

Expose tension pairs with cluster context so a local LLM can generate research hypotheses.

- [ ] `app/api/hypothesis-data/route.ts`
- [ ] Fetch tensions + clusters + note contents in parallel
- [ ] Return `{ tensions[], tensionCount, computedAt }` — each tension includes full noteA/noteB content + cluster sibling notes
- [ ] Local LLM generates hypothesis statement, 2–3 open questions, and cluster combination suggestions
- [ ] Hypotheses submitted back as notes via existing `POST /api/add-note` with `type: hypothesis` frontmatter tag (no new storage format needed)
- [ ] Integration tests (4+ via vitest)

**Done when:** Endpoint returns tension + cluster context sufficient for a local LLM to generate and submit hypothesis notes.

---

## Priority 22 — Refinement Pass (GET + POST)

Advisory-only note improvement suggestions from a local LLM. No automatic edits.

- [ ] `types/refinement.ts` — `RefinementType`, `RefinementSuggestion`, `RefinementsIndex` type definitions
- [ ] `RefinementType`: `'retitle' | 'split' | 'merge-suggest' | 'update'`
- [ ] `RefinementSuggestion` — id, noteId, type, suggestion (proposed change), reason, relatedNoteIds (for merge suggestions), generatedAt
- [ ] `app/api/refinement-data/route.ts` — expose clusters with full note content + decay records; optional `?clusterId=X` param
- [ ] `app/api/refinements/route.ts` — accept suggestions array, upsert to `index/refinements.json` by noteId + type
- [ ] `readRefinementsIndex()`, `writeRefinementsIndex()` GitHub helpers
- [ ] Code comment constraint: "Suggestions only — SlipBox never modifies user notes automatically."
- [ ] Integration tests (4+ via vitest)

**Done when:** Suggestions are persisted and queryable; they do not touch note files.

---

## Priority 23 — Snapshot Module + Graph Analytics

Append-only evolution timeline — one snapshot per nightly run.

- [ ] `types/snapshot.ts` — `GraphSnapshot`, `SnapshotsIndex` type definitions
- [ ] `GraphSnapshot` — id, capturedAt, noteCount, linkCount, clusterCount, tensionCount, decayCount, clusterSizes (clusterId → noteCount), avgLinksPerNote
- [ ] `SnapshotsIndex` — append-only array ordered by capturedAt
- [ ] `src/snapshot.ts` — `captureSnapshot(embeddingsIndex, backlinksIndex, clustersIndex, tensionsIndex, decayIndex)` → `GraphSnapshot`
- [ ] `app/api/snapshot/route.ts` — fetch all indexes → compute snapshot → append to `index/snapshots.json` → return new snapshot
- [ ] `app/api/analytics/route.ts` — return full snapshots array; optional `?since=ISO-DATE` param; include computed deltas between consecutive snapshots
- [ ] `readSnapshotsIndex()`, `writeSnapshotsIndex()` GitHub helpers
- [ ] Unit tests (15+ via vitest) — snapshot computation, delta calculation; integration tests (3+)

**Done when:** Nightly runs accumulate a queryable daily timeline; analytics endpoint shows growth trajectory with deltas.

---

## Priority 24 — Exploration Pass (pure math)

Structural gap detection — no LLM, no external dependencies.

- [ ] `types/exploration.ts` — `ExplorationSuggestionType`, `ExplorationSuggestion`, `ExplorationsIndex` type definitions
- [ ] `ExplorationSuggestionType`: `'orphan-note' | 'close-clusters' | 'structural-hole' | 'meta-note-missing'`
- [ ] `src/exploration.ts` — `detectExplorations(embeddingsIndex, backlinksIndex, clustersIndex, relationsIndex, config)` → `ExplorationsIndex`
- [ ] Detection logic:
  - **orphan-note:** notes in embeddings index with zero backlinks
  - **close-clusters:** cluster pairs with centroid cosine similarity > `CLOSE_CLUSTER_THRESHOLD` (default 0.85) — candidates for merge
  - **structural-hole:** clusters with no typed relations to any note outside the cluster
  - **meta-note-missing:** clusters where no member note has `type: meta` in frontmatter
- [ ] Config tunables: `EXPLORATIONS_INDEX_PATH`, `CLOSE_CLUSTER_THRESHOLD`
- [ ] `app/api/exploration-pass/route.ts` — fetch all indexes → run detection → commit `explorations.json` → return suggestion list
- [ ] `readExplorationsIndex()`, `writeExplorationsIndex()` GitHub helpers
- [ ] Unit tests (30+ via vitest) — each detection type; integration tests (4+)

**Done when:** exploration-pass detects all four structural gap types and commits results.

---

## Priority 25 — Nightly Phase 4 Passes

Extend the nightly GitHub Actions workflow to include Phase 4 passes.

- [ ] `.github/workflows/nightly-passes.yml` — extend job chain: `link-pass → cluster-pass → tension-pass → [decay-pass ∥ exploration-pass] → snapshot`
- [ ] `decay-pass` and `exploration-pass` run in parallel (both depend on tension-pass, neither depends on the other)
- [ ] `snapshot` runs last after all indexes are fresh
- [ ] `workflow_dispatch` input to skip individual passes (for debugging)

**Done when:** All Phase 4 passes run automatically each night; snapshots accumulate a daily timeline.

---

## Priority 26 — Graph Explorer UI

Interactive visualization of the knowledge graph — the only Phase 4 frontend work.

- [ ] `app/graph/page.tsx` — auth-gated route
- [ ] `app/graph/GraphCanvas.tsx` — force-directed graph component
- [ ] One new dependency: `react-force-graph-2d` (only external dep added in Phase 4)
- [ ] Node encoding: size = link count, gray tint intensity = decay score
- [ ] Edge encoding: color = relation type (green = supports, red = contradicts, blue = refines, yellow = contrasts-with, gray = unclassified)
- [ ] Tension edges rendered as dashed lines (toggleable)
- [ ] Click a node → sidebar: note title, cluster, decay reasons, refinement suggestions
- [ ] Filter controls: by cluster, toggle meta-notes, toggle tensions
- [ ] Data from existing endpoints: `/api/link-data`, `/api/theme-data`, `/api/analytics`

**Done when:** Graph loads, renders typed edges with color coding, node sidebar shows note metadata.

---

## Deferred (Phase 3+ continued)

- Emergent theme detection (weekly cognitive summary)
- Theory evolution engine

---

## Guiding Constraints

- No user data in this repo. Ever.
- No persistent database — GitHub is the database.
- No automatic note rewriting.
- Every link must be deterministic and transparent.
- Keep dependencies minimal.
