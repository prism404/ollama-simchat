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
