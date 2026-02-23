# SlipBox

A Zettelkasten-style semantic thinking engine. Captures atomic ideas, embeds them in semantic space, auto-links related notes, clusters them into themes, and surfaces conceptual tensions.

**The engine is public. The knowledge is private.**

SlipBox runs on Vercel and reads/writes to a user-owned private GitHub repository (PrivateBox). No database — GitHub is the database.

---

## How It Works

```
User → LLM Agent → SlipBox API → OpenAI Embeddings → GitHub API → PrivateBox
```

1. Submit a raw thought via `POST /api/add-note`
2. SlipBox normalizes it, generates an embedding, finds similar notes, and commits everything to PrivateBox
3. Run passes periodically (or nightly via GitHub Actions) to recompute links, clusters, and tensions
4. Feed `GET /api/theme-data` to a local LLM agent to synthesize meta-notes per cluster

---

## API Endpoints

All endpoints require `Authorization: Bearer <SLIPBOX_API_KEY>`.

### `POST /api/add-note`

Add a new atomic note. Runs the full pipeline: normalize → embed → similarity pass → link → commit.

```json
// Request
{ "content": "Agents shine when ambiguity exists." }

// Response
{ "noteId": "20260222T153045-a1b2c3d4", "linkedNotes": [{ "noteId": "...", "similarity": 0.91 }] }
```

### `POST /api/link-pass`

Recomputes all similarity links across the full embeddings index and rebuilds `backlinks.json`.

### `POST /api/cluster-pass`

Clusters the embedding space using k-means and commits `clusters.json` to PrivateBox.

```json
// Optional body — override automatic cluster count
{ "k": 5 }
```

### `POST /api/tension-pass`

Detects semantic tensions — pairs of notes within the same cluster whose embeddings diverge significantly. Commits `tensions.json`. Requires a current clusters index (run cluster-pass first).

### `GET /api/theme-data`

Returns everything a local LLM agent needs to synthesize meta-notes: cluster assignments, full note content (title + body), and detected tensions. No embeddings — only human-readable content.

```json
{
  "clusters": [
    {
      "id": "cluster-0",
      "noteIds": ["20260101T000000-aaaaaaaa", "..."],
      "notes": {
        "20260101T000000-aaaaaaaa": { "title": "Agents and ambiguity", "body": "..." }
      }
    }
  ],
  "tensions": [{ "id": "tension-0", "noteA": "...", "noteB": "...", "similarity": 0.65, "clusterId": "cluster-0" }],
  "clusterCount": 1,
  "noteCount": 12,
  "tensionCount": 2,
  "computedAt": "2026-01-01T00:00:00Z"
}
```

Intended workflow: fetch this payload with a local LLM agent, synthesize a meta-note per cluster, and submit each back via `POST /api/add-note`.

### `GET /api/health`

Health check. Returns `{ "ok": true }`.

---

## Nightly Automation

GitHub Actions runs the three passes in sequence each night at 3 AM UTC:

```
link-pass → cluster-pass → tension-pass
```

Configured in `.github/workflows/nightly-passes.yml`. Can also be triggered manually via **Actions → Nightly Passes → Run workflow**.

Required GitHub Actions secrets:

| Secret | Value |
|--------|-------|
| `SLIPBOX_URL` | Your Vercel deployment URL (e.g. `https://slipbox.vercel.app`) |
| `SLIPBOX_API_KEY` | Same value as your `SLIPBOX_API_KEY` environment variable |

---

## Setup

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key for generating embeddings |
| `GITHUB_TOKEN` | Yes | GitHub token for reading/writing to PrivateBox |
| `PRIVATEBOX_OWNER` | Yes | GitHub owner of the PrivateBox repo |
| `PRIVATEBOX_REPO` | Yes | PrivateBox repo name (e.g. `PrivateBox`) |
| `SLIPBOX_API_KEY` | Yes | Shared secret for authenticating inbound API requests |
| `EMBEDDING_MODEL` | No | OpenAI embedding model (default: `text-embedding-3-large`) |
| `SIMILARITY_THRESHOLD` | No | Cosine similarity threshold for linking notes (default: `0.82`) |
| `NOTES_DIR` | No | PrivateBox directory for note files (default: `notes`) |
| `MIN_CLUSTERS` | No | Minimum k-means cluster count (default: `2`) |
| `MAX_CLUSTERS` | No | Maximum k-means cluster count (default: `20`) |
| `TENSION_THRESHOLD` | No | Max similarity for a pair to be flagged as a tension (default: `0.72`) |

### OpenAI API Key Permissions

SlipBox only uses the embeddings endpoint (`POST /v1/embeddings`). Minimum required permissions for a restricted key:

- **Model capabilities**: `Request` (the parent toggle — this grants `model.request`)
  - Individual child endpoints can be left at their defaults

All other sections (Assistants, Threads, Files, etc.) can remain `None`.

### PrivateBox Structure

SlipBox reads and writes the following paths in PrivateBox:

```
notes/                  ← atomic note files (markdown + YAML frontmatter)
index/
  embeddings.json       ← embedding vectors per note
  backlinks.json        ← bidirectional link graph
  clusters.json         ← k-means cluster assignments
  tensions.json         ← detected semantic tensions
```

---

## Guiding Principles

- Engine is public. Knowledge is private.
- GitHub is the database. No external persistence layer.
- Notes are never automatically rewritten.
- Every link is deterministic and transparent.
- Dependencies are kept minimal.
