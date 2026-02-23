# SlipBox
A Zettelkasten (German for "slip box") is a personal knowledge management method using interconnected, atomistic notes to foster creative thinking. This project helps with  creating "permanent" notes from fleeting thoughts or literature, linking them to existing notes, and organizing them to build a, "second brain".

## Setup

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key for generating embeddings |
| `GITHUB_TOKEN` | Yes | GitHub token for reading/writing to PrivateBox |
| `PRIVATEBOX_REPO` | Yes | PrivateBox repo in `owner/repo` format (e.g. `Randroids-Dojo/PrivateBox`) |
| `PRIVATEBOX_OWNER` | Yes | GitHub owner of the PrivateBox repo |
| `SLIPBOX_API_KEY` | Yes | Shared secret for authenticating API requests to this service |
| `EMBEDDING_MODEL` | No | OpenAI embedding model to use (default: `text-embedding-3-large`) |

### OpenAI API Key Permissions

SlipBox only uses the OpenAI embeddings endpoint (`POST /v1/embeddings`). However, OpenAI requires the parent **Model capabilities** scope to be set to `Request` for the `model.request` scope to be granted — setting only the `Embeddings` child permission is not sufficient.

Minimum required permissions for a restricted key:

- **Model capabilities**: `Request` (the parent toggle — this grants `model.request`)
  - Individual child endpoints can be left at their defaults

All other sections (Assistants, Threads, Files, etc.) can remain `None`.
