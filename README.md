# Local Character Chat — memory core

This repository currently contains the first database foundation for a private,
local character chat application. It uses Node.js 24 and SQLite with no external
runtime dependencies.

## What is already modelled

- several personas, characters and independent stories;
- versioned permanent character profiles;
- dynamic character and relationship state per story;
- immutable messages and versioned scene state;
- events, promises, plans and hidden character intentions;
- proposed/approved/corrected/rejected memories with message sources;
- local embedding storage and French/English full-text search;
- append-only conversation, weekly and consolidated summaries;
- contradiction reports and weekly update audit runs.

The database is designed so that AI-generated proposals never become trusted
facts before review. Old summaries remain available after a new version is
created.

The permanent core and dynamic state are deliberately separate:

- `character_core_versions` contains identity, values, deep traits, voice and
  boundaries. A proposed change only becomes active after approval.
- `character_state_versions` contains mood, current goals, beliefs, relationship
  state, learned lessons and behavioural adjustments for one story.
- the `current_character_core` and `current_character_state` views expose the
  latest approved versions without deleting any prior version.

## Requirements on Windows

Install Node.js 24 or newer, then open PowerShell in this project folder.

## Initialize and inspect the database

```powershell
npm run db:init
npm run db:check
npm run db:inspect
```

The database file is created at `data/character-chat.db`.

To add disposable example data:

```powershell
npm run db:seed-demo
npm run db:inspect
```

Do not run the demo seed repeatedly; it intentionally creates a new example on
each execution.

## Open it visually

The easiest option is **DB Browser for SQLite**:

1. Install DB Browser for SQLite from its official website.
2. Choose **Open Database**.
3. Select `data/character-chat.db`.
4. Use **Database Structure** to inspect tables.
5. Use **Browse Data** to inspect rows.
6. Use **Execute SQL** for queries.

Useful queries:

```sql
-- Memories waiting for your decision
SELECT id, title, content, importance, confidence
FROM memory_items
WHERE review_status = 'proposed'
ORDER BY importance DESC, created_at DESC;

-- Current unresolved contradictions
SELECT id, category, severity, description, suggested_resolution
FROM contradiction_reports
WHERE status = 'open'
ORDER BY severity DESC, detected_at DESC;

-- Latest summary versions without deleting history
SELECT story_id, summary_type, version_number, review_status, content, created_at
FROM summary_versions
ORDER BY story_id, summary_type, version_number DESC;

-- The permanent profile currently allowed into the prompt
SELECT * FROM current_character_core;

-- Dynamic state currently allowed into the prompt
SELECT * FROM current_character_state;

-- Events and promises that still need continuity
SELECT title, thread_type, status, visibility, due_story_datetime
FROM story_threads
WHERE status IN ('open', 'announced', 'in_progress')
ORDER BY importance DESC, created_at;
```

## Planned application layers

1. Local API in TypeScript to read/write the database.
2. Ollama chat adapter using `http://localhost:11434`.
3. Memory extraction that creates reviewable proposals.
4. Hybrid retrieval: SQLite FTS plus BGE-M3 embeddings.
5. Weekly append-only synthesis and contradiction detection.
6. React web interface for character creation, chat and memory review.

For the first model benchmark, start with `qwen3.5:9b` and compare it with
`gemma4:e4b` using the same French/mixed-language scenes. BGE-M3 is reserved for
embeddings; it is not the dialogue model.

## Memory review workflow

Run `npm run db:init` once after pulling these changes, before starting the API.
It applies the version 2 migration in a transaction and preserves existing data.
Running it again is safe. Do not delete or recreate your database.

Start the API with `npm start`. Ollama must be running with the configured
`OLLAMA_MODEL` for extraction. The existing `npm run memory:propose -- 1` command
remains a read-only preview.

The API uses these statuses (with their existing SQLite equivalents): `pending`
(`proposed`), `accepted` (`approved`), `corrected`, `rejected`, `superseded`.

```sh
# Extract and persist proposals with their source messages.
curl -X POST http://127.0.0.1:3000/api/conversations/1/memories/propose

# List pending proposals, including scores, source excerpts and review history.
curl 'http://127.0.0.1:3000/api/conversations/1/memories?status=pending'

# Omit the filter to include reviewed proposals and their history.
curl http://127.0.0.1:3000/api/conversations/1/memories

# Replace 42 with a returned memory ID; review each pending proposal only once.
curl -X POST http://127.0.0.1:3000/api/memories/42/review \
  -H 'Content-Type: application/json' -d '{"decision":"accept"}'

curl -X POST http://127.0.0.1:3000/api/memories/43/review \
  -H 'Content-Type: application/json' \
  -d '{"decision":"reject","reason":"Souvenir non pertinent"}'

curl -X POST http://127.0.0.1:3000/api/memories/44/review \
  -H 'Content-Type: application/json' \
  -d '{"decision":"correct","title":"Préférence pour les lieux calmes","content":"Le persona déteste les lieux très bruyants et souhaite privilégier les lieux calmes.","reason":"Reformulation plus fidèle"}'
```

A correction validates the corrected text. Each decision records the original
and resulting title/content, reason and timestamp in `memory_reviews`, in the
same transaction as the memory update. Reviewed proposals return HTTP 409 if
reviewed again. Invalid input returns 400, missing resources 404, and extraction
failures 502 without persisting partial proposals.

Extraction returns `memories` (new rows), `existing` (identical proposals already
stored), `createdCount`, `duplicateCount`, `model` and `totalDurationMs`. It returns
201 when rows were created, otherwise 200. Identity includes the conversation,
character/persona/relationship, type, scope, title, content, event date and sorted
source IDs; changing confidence, importance, emotional weight or keywords alone
does not create another identical proposal. The immutable fingerprint survives
correction and rejection. This is exact deduplication, not semantic similarity.

Only active accepted/corrected memories are eligible for future context use.
This release does not inject memories into chat prompts or add embeddings.
Historical rows remain unchanged; those with message sources can be listed via
their source conversations. Historical reviews have null titles when these were
not originally recorded.

Run `npm run test:memory` for automated date and workflow checks. Workflow tests
use a disposable database and simulated extraction, exercising the actual HTTP
routes without requiring Ollama or modifying your database. Manual extraction
with the first request above verifies your real Ollama connection.
