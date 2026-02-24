# SlipBox

Public cognitive engine.
Private knowledge graph.

SlipBox is an open-source, cloud-enhanced Zettelkasten framework that operates on a user-owned private repository (PrivateBox). The engine is public. The knowledge is private.

---

# 1. Philosophy

SlipBox is not a notes app.

It is a semantic thinking engine designed to:

- Capture atomic ideas
- Embed them in semantic space
- Interconnect them automatically
- Surface emergent patterns
- Detect conceptual tensions
- Evolve long-term theory structures

The public repository contains only tooling and engine logic.
All user knowledge lives in a separate private repository.

---

# 2. Repository Structure

## 2.1 SlipBox (Public Repo)

Contains:

/app
  /api
    add-note          — POST: ingest a note, embed, link, commit
    link-pass         — POST: recompute all backlinks
    cluster-pass      — POST: k-means cluster the embedding space
    tension-pass      — POST: detect divergent pairs within clusters
    theme-data        — GET: fetch cluster/tension data for LLM synthesis
    link-data         — GET: fetch backlink pairs with content for LLM classification
    relations         — POST: persist typed relation records from LLM agent
    decay-pass        — POST: score notes for staleness; commit decay.json
    hypothesis-data   — GET: fetch tension/cluster data for LLM hypothesis generation
    refinement-data   — GET: fetch cluster/decay data for LLM refinement analysis
    refinements       — POST: persist advisory refinement suggestions from LLM agent
    snapshot          — POST: capture point-in-time graph snapshot; append to snapshots.json
    analytics         — GET: return snapshot history with deltas; supports ?since=ISO-DATE
    exploration-pass  — POST: detect structural gaps; commit explorations.json

/src
  auth.ts
  cluster.ts
  config.ts
  decay.ts
  embeddings.ts
  exploration.ts
  github.ts
  graph.ts
  note.ts
  relation.ts
  similarity.ts
  snapshot.ts
  tension.ts

/types
  cluster.ts
  decay.ts
  embedding.ts
  exploration.ts
  graph.ts
  note.ts
  refinement.ts
  relation.ts
  snapshot.ts
  tension.ts

/.github/workflows
  nightly-passes.yml  — link-pass → cluster-pass → tension-pass at 3 AM UTC

Docs/Plan.md
Docs/Priorities.md

This repository:
- Runs on Vercel
- Exposes API endpoints
- Calls OpenAI embeddings
- Performs semantic linking
- Commits changes to PrivateBox via GitHub API

It contains no user knowledge.

---

## 2.2 PrivateBox (Private Repo)

Contains:

/notes
/index
  embeddings.json
  backlinks.json
  clusters.json
  tensions.json
  relations.json
  decay.json
  refinements.json
  explorations.json
  snapshots.json

This repository:
- Stores atomic markdown notes
- Stores semantic embeddings
- Stores backlink graph
- Stores cluster metadata
- Stores tension records
- Stores typed semantic relations
- Stores staleness scores
- Stores advisory refinement suggestions
- Stores structural gap detections
- Stores append-only graph evolution timeline

It contains no engine logic.

---

# 3. Core Architecture

User → ChatGPT → SlipBox API → OpenAI API → GitHub API → PrivateBox

Flow:

1. User provides raw thought.
2. ChatGPT calls SlipBox API.
3. SlipBox:
   - Atomizes note
   - Generates metadata
   - Creates embedding
   - Runs similarity pass
   - Updates backlinks
   - Commits changes
4. PrivateBox updates.

GitHub is the database.

---

# 4. API Endpoints

## POST /api/add-note

Input: `{ "content": "...", "type"?: "meta" | "hypothesis" }`

Pipeline: normalize → embed → similarity pass → update backlinks → commit.

Output: `{ "noteId": "...", "linkedNotes": [...] }`

---

## POST /api/link-pass

Recomputes similarity across the entire graph.
Rebuilds backlinks.json and commits.

---

## POST /api/cluster-pass

K-means clusters the embedding space (automatic K or `{ "k": N }`).
Commits clusters.json.

---

## POST /api/tension-pass

Detects divergent note pairs within clusters.
Commits tensions.json.

---

## GET /api/theme-data

Returns clusters + tensions + full note content for each cluster member.
Used by local LLM agents to synthesize meta-notes, submitted back via add-note.

---

## GET /api/link-data

Returns deduplicated backlink pairs with full note content and existing relation
classification. Supports `?unclassifiedOnly=true` for incremental runs.
Used by local LLM agents to classify semantic relation types.

---

## POST /api/relations

Input: `{ "relations": [{ "noteA", "noteB", "relationType", "reason" }] }`

Accepts typed relation records from a local LLM agent.
Validates relation types and backlink membership.
Upserts into relations.json with similarity from backlinks index.
Output: `{ "updated", "total" }`

---

## GET /api/hypothesis-data

Returns each tension pair with full note content for both tension notes and all
cluster sibling notes. Used by local LLM agents to generate hypothesis notes,
submitted back via add-note with `type: hypothesis` in frontmatter.

---

## GET /api/refinement-data

Returns clusters with full note content and decay records for each cluster member.
Supports `?clusterId=X` to restrict to a single cluster.
Used by local LLM agents to generate advisory refinement suggestions.

---

## POST /api/refinements

Input: `{ "suggestions": [{ "noteId", "type", "suggestion", "reason", "relatedNoteIds"? }] }`

Accepts advisory refinement suggestions from a local LLM agent.
Validates types (`retitle`, `split`, `merge-suggest`, `update`).
Upserts into refinements.json by `${noteId}:${type}` key (one suggestion per note per type).
Suggestions only — SlipBox never modifies user notes automatically.
Output: `{ "updated", "total" }`

---

## POST /api/decay-pass

Scores every note for staleness using four pure-math signals: no links, low link density,
cluster outlier, and no cluster. No LLM calls. Commits decay.json.
Output: `{ "noteCount", "staleCount", "records" }`

---

## POST /api/snapshot

Captures a point-in-time graph snapshot (counts, cluster sizes, avg links per note).
Appends to the append-only snapshots.json.
Output: the new `GraphSnapshot` record.

---

## GET /api/analytics

Returns the full snapshots history. Supports `?since=ISO-DATE` to filter.
Includes computed deltas between consecutive snapshots.
Output: `{ "snapshots", "snapshotCount", "since"? }`

---

## POST /api/exploration-pass

Detects four structural gap types — orphan notes (zero backlinks), close cluster pairs
(centroid similarity above threshold), structural holes (clusters with no external typed
relations), and meta-note-missing (clusters with no meta-typed member note).
No LLM calls. Commits explorations.json.
Output: `{ "suggestionCount", "byType", "suggestions" }`

---

# 5. Embedding Strategy

Default:
Model: text-embedding-3-large

Embeddings are stored inside PrivateBox:
/index/embeddings.json

Embeddings are considered private metadata.

SlipBox must support pluggable providers in future:

interface EmbeddingProvider {
  embed(text: string): Promise<number[]>
}

---

# 6. Similarity & Linking

Cosine similarity.

Threshold (default):
0.82

When similarity exceeds threshold:
- Add forward link
- Add backlink
- Update backlinks.json

Linking must be deterministic and transparent.
SlipBox must not rewrite original note content automatically.

---

# 7. GitHub Integration

SlipBox uses:
- Fine-grained GitHub token
- Limited to one PrivateBox repo
- Read/write contents permission only

Token stored in Vercel environment variables.

GitHub acts as:
- Persistence layer
- Version history
- Backup system

---

# 8. Security Model

- SlipBox repo contains no user data.
- PrivateBox repo is fully user-controlled.
- All API tokens stored in environment variables.
- No persistent database required for V1.

Optional future:
- Encrypted local-only mode
- Self-hosted mode
- Local embedding mode

---

# 9. Evolution

Phase 1 (complete):
Manual note ingestion, embedding, auto-linking.

Phase 2 (complete):
K-means clustering + tension detection.

Phase 3 (complete):
Nightly scheduled passes (GitHub Actions).
GET /api/theme-data for LLM-driven meta-note synthesis.

Phase 4 (in progress):
Typed semantic edges, staleness detection, hypothesis context, advisory refinement suggestions,
evolution timeline (snapshot + analytics), and structural gap detection — complete through Priority 24.
Remaining: nightly Phase 4 automation, graph explorer UI.

---

# 10. Non-Goals

SlipBox will NOT:
- Automatically rewrite notes.
- Replace human judgment.
- Collapse nuance into summaries.
- Become a productivity dashboard.

It is a thinking substrate.

---

# 11. Guiding Principles

1. Engine is public.
2. Knowledge is private.
3. GitHub is the database.
4. Embeddings are metadata.
5. Linking is transparent.
6. Reasoning is optional.
7. System must remain durable long-term.

---

SlipBox is infrastructure for compounding thought.
