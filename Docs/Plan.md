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
    add-note
    link-pass
    cluster-pass
    tension-pass

/src
  embeddings.ts
  similarity.ts
  graph.ts
  github.ts
  note.ts
  config.ts

/types
  note.ts
  embedding.ts

PLAN.md
README.md

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
/meta

This repository:
- Stores atomic markdown notes
- Stores semantic embeddings
- Stores backlink graph
- Stores cluster metadata

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

# 4. API Endpoints (V1)

## POST /api/add-note

Input:
{
  "content": "Agents shine when ambiguity exists."
}

Pipeline:
1. Normalize to atomic note format.
2. Generate unique ID.
3. Generate embedding via OpenAI.
4. Fetch embeddings.json from PrivateBox.
5. Compute cosine similarity.
6. Auto-link above threshold.
7. Update embeddings.json and backlinks.json.
8. Commit note + index updates.

Output:
{
  "noteId": "...",
  "linkedNotes": [...]
}

---

## POST /api/link-pass

Recomputes similarity across entire graph.
Updates backlinks.
Commits changes.

---

## POST /api/cluster-pass

Clusters embedding space.
Creates or updates meta-notes for themes.
Commits cluster metadata.

---

## POST /api/tension-pass

Detects semantic contradictions.
Creates tension notes for unresolved conflicts.

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

# 9. Future Evolution

Phase 1:
Manual note ingestion + auto-linking.

Phase 2:
Nightly cluster and tension passes.

Phase 3:
Emergent theme detection.
Meta-note synthesis.
Weekly cognitive summary.

Phase 4:
Theory evolution engine.
AI proposes unexplored conceptual regions.

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
