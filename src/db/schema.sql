PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

-- The human personas played by the owner of the application.
CREATE TABLE IF NOT EXISTS personas (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  pronouns TEXT,
  description TEXT NOT NULL DEFAULT '',
  preferences_json TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

-- Stable identity of a fictional character. Its permanent core is versioned below.
CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  short_label TEXT NOT NULL DEFAULT '',
  avatar_path TEXT,
  default_language TEXT NOT NULL DEFAULT 'fr' CHECK (default_language IN ('fr', 'en', 'mixed')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

-- Append-only versions of the character's permanent foundation.
CREATE TABLE IF NOT EXISTS character_core_versions (
  id INTEGER PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  identity_json TEXT NOT NULL DEFAULT '{}',
  appearance_json TEXT NOT NULL DEFAULT '{}',
  biography_json TEXT NOT NULL DEFAULT '{}',
  personality_json TEXT NOT NULL DEFAULT '{}',
  values_json TEXT NOT NULL DEFAULT '[]',
  motivations_json TEXT NOT NULL DEFAULT '[]',
  fears_json TEXT NOT NULL DEFAULT '[]',
  flaws_json TEXT NOT NULL DEFAULT '[]',
  boundaries_json TEXT NOT NULL DEFAULT '[]',
  speech_style_json TEXT NOT NULL DEFAULT '{}',
  behavior_rules_json TEXT NOT NULL DEFAULT '[]',
  immutable_facts_json TEXT NOT NULL DEFAULT '[]',
  change_reason TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'user' CHECK (created_by IN ('user', 'assistant', 'migration')),
  review_status TEXT NOT NULL DEFAULT 'proposed' CHECK (review_status IN ('proposed', 'approved', 'corrected', 'rejected', 'superseded')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  UNIQUE(character_id, version_number)
) STRICT;

CREATE TABLE IF NOT EXISTS character_dialogue_examples (
  id INTEGER PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  core_version_id INTEGER REFERENCES character_core_versions(id) ON DELETE SET NULL,
  situation_key TEXT NOT NULL,
  situation_description TEXT NOT NULL,
  user_message TEXT,
  ideal_response TEXT NOT NULL,
  response_strategy TEXT NOT NULL DEFAULT '',
  anti_pattern TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'fr' CHECK (language IN ('fr', 'en', 'mixed')),
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  world_rules_json TEXT NOT NULL DEFAULT '{}',
  tone_json TEXT NOT NULL DEFAULT '{}',
  default_language TEXT NOT NULL DEFAULT 'fr' CHECK (default_language IN ('fr', 'en', 'mixed')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE IF NOT EXISTS story_cast (
  id INTEGER PRIMARY KEY,
  story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'main',
  joins_at TEXT,
  leaves_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  UNIQUE(story_id, character_id)
) STRICT;

CREATE TABLE IF NOT EXISTS story_personas (
  id INTEGER PRIMARY KEY,
  story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  persona_id INTEGER NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'protagonist',
  UNIQUE(story_id, persona_id)
) STRICT;

-- The relationship is specific to one story, so parallel stories never leak into each other.
CREATE TABLE IF NOT EXISTS relationships (
  id INTEGER PRIMARY KEY,
  story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  persona_id INTEGER NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  initial_context TEXT NOT NULL DEFAULT '',
  current_label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(story_id, character_id, persona_id)
) STRICT;

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY,
  story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'archived'))
) STRICT;

-- Messages are the immutable source of truth. Corrections create a new row linked by supersedes_message_id.
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sequence_number INTEGER NOT NULL,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('persona', 'character', 'narrator', 'system')),
  persona_id INTEGER REFERENCES personas(id) ON DELETE SET NULL,
  character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'fr' CHECK (language IN ('fr', 'en', 'mixed')),
  sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  supersedes_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(conversation_id, sequence_number),
  CHECK (
    (sender_type = 'persona' AND persona_id IS NOT NULL)
    OR (sender_type = 'character' AND character_id IS NOT NULL)
    OR sender_type IN ('narrator', 'system')
  )
) STRICT;

-- Versioned snapshots of the immediate scene: place, time, present people and action in progress.
CREATE TABLE IF NOT EXISTS scene_state_versions (
  id INTEGER PRIMARY KEY,
  story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  previous_version_id INTEGER REFERENCES scene_state_versions(id) ON DELETE SET NULL,
  source_conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  source_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  location TEXT,
  story_datetime TEXT,
  present_character_ids_json TEXT NOT NULL DEFAULT '[]',
  current_action TEXT NOT NULL DEFAULT '',
  atmosphere TEXT NOT NULL DEFAULT '',
  open_question TEXT NOT NULL DEFAULT '',
  state_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT 'extractor' CHECK (created_by IN ('user', 'extractor', 'weekly_update')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(story_id, version_number)
) STRICT;

-- Announced, ongoing or completed events and promises. Hidden rows enable surprise without losing coherence.
CREATE TABLE IF NOT EXISTS story_threads (
  id INTEGER PRIMARY KEY,
  story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  thread_type TEXT NOT NULL CHECK (thread_type IN ('event', 'promise', 'plan', 'question', 'conflict', 'goal', 'secret')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'announced', 'in_progress', 'completed', 'cancelled', 'expired')),
  initiated_by_type TEXT NOT NULL CHECK (initiated_by_type IN ('persona', 'character', 'narrator', 'system')),
  initiated_by_id INTEGER,
  visibility TEXT NOT NULL DEFAULT 'visible' CHECK (visibility IN ('visible', 'hidden_until_triggered', 'character_private')),
  trigger_conditions_json TEXT NOT NULL DEFAULT '{}',
  due_story_datetime TEXT,
  importance INTEGER NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  source_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  resolved_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
) STRICT;

-- Dynamic personality and relationship state. Append-only so evolution can be explained and rolled back.
CREATE TABLE IF NOT EXISTS character_state_versions (
  id INTEGER PRIMARY KEY,
  story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  relationship_id INTEGER REFERENCES relationships(id) ON DELETE SET NULL,
  version_number INTEGER NOT NULL,
  previous_version_id INTEGER REFERENCES character_state_versions(id) ON DELETE SET NULL,
  mood_json TEXT NOT NULL DEFAULT '{}',
  current_goals_json TEXT NOT NULL DEFAULT '[]',
  current_beliefs_json TEXT NOT NULL DEFAULT '[]',
  relationship_state_json TEXT NOT NULL DEFAULT '{}',
  internal_conflicts_json TEXT NOT NULL DEFAULT '[]',
  learned_lessons_json TEXT NOT NULL DEFAULT '[]',
  behavioral_adjustments_json TEXT NOT NULL DEFAULT '[]',
  development_summary TEXT NOT NULL DEFAULT '',
  change_reason TEXT NOT NULL,
  source_message_start_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  source_message_end_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL DEFAULT 'extractor' CHECK (created_by IN ('user', 'extractor', 'weekly_update')),
  review_status TEXT NOT NULL DEFAULT 'proposed' CHECK (review_status IN ('proposed', 'approved', 'corrected', 'rejected')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  UNIQUE(story_id, character_id, version_number)
) STRICT;

-- Atomic facts/events used for retrieval. Proposed memories never enter prompts until approved.
CREATE TABLE IF NOT EXISTS memory_items (
  id INTEGER PRIMARY KEY,
  story_id INTEGER REFERENCES stories(id) ON DELETE CASCADE,
  character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
  persona_id INTEGER REFERENCES personas(id) ON DELETE CASCADE,
  relationship_id INTEGER REFERENCES relationships(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('fact', 'event', 'preference', 'promise', 'relationship', 'lesson', 'secret', 'observation')),
  scope TEXT NOT NULL CHECK (scope IN ('global_character', 'story', 'relationship', 'persona')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '',
  event_datetime TEXT,
  importance INTEGER NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  emotional_weight INTEGER NOT NULL DEFAULT 0 CHECK (emotional_weight BETWEEN -5 AND 5),
  confidence REAL NOT NULL DEFAULT 0.7 CHECK (confidence BETWEEN 0.0 AND 1.0),
  review_status TEXT NOT NULL DEFAULT 'proposed' CHECK (review_status IN ('proposed', 'approved', 'corrected', 'rejected', 'superseded')),
  lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active', 'resolved', 'expired', 'invalidated')),
  created_by TEXT NOT NULL DEFAULT 'extractor' CHECK (created_by IN ('user', 'extractor', 'weekly_update', 'migration')),
  valid_from TEXT,
  valid_until TEXT,
  last_recalled_at TEXT,
  recall_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  CHECK (story_id IS NOT NULL OR character_id IS NOT NULL OR persona_id IS NOT NULL)
) STRICT;

CREATE TABLE IF NOT EXISTS memory_sources (
  memory_id INTEGER NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  source_excerpt TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(memory_id, message_id)
) STRICT;

CREATE TABLE IF NOT EXISTS memory_reviews (
  id INTEGER PRIMARY KEY,
  memory_id INTEGER NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'corrected', 'rejected', 'superseded')),
  previous_content TEXT,
  resulting_content TEXT,
  note TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE IF NOT EXISTS memory_links (
  from_memory_id INTEGER NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  to_memory_id INTEGER NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK (link_type IN ('supports', 'contradicts', 'supersedes', 'causes', 'follows', 'related')),
  explanation TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(from_memory_id, to_memory_id, link_type),
  CHECK (from_memory_id <> to_memory_id)
) STRICT;

-- Float32 vectors are stored as binary blobs. At this scale cosine similarity can be computed in Node.
CREATE TABLE IF NOT EXISTS memory_embeddings (
  memory_id INTEGER PRIMARY KEY REFERENCES memory_items(id) ON DELETE CASCADE,
  model_name TEXT NOT NULL,
  dimensions INTEGER NOT NULL CHECK (dimensions > 0),
  vector_blob BLOB NOT NULL,
  content_hash TEXT NOT NULL,
  embedded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

-- Summaries are append-only. A consolidated summary points to its component summaries below.
CREATE TABLE IF NOT EXISTS summary_versions (
  id INTEGER PRIMARY KEY,
  story_id INTEGER REFERENCES stories(id) ON DELETE CASCADE,
  character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
  relationship_id INTEGER REFERENCES relationships(id) ON DELETE CASCADE,
  summary_type TEXT NOT NULL CHECK (summary_type IN ('conversation', 'weekly', 'rolling', 'consolidated', 'character_development')),
  version_number INTEGER NOT NULL,
  previous_version_id INTEGER REFERENCES summary_versions(id) ON DELETE SET NULL,
  period_start TEXT,
  period_end TEXT,
  content TEXT NOT NULL,
  structured_state_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT 'summarizer' CHECK (created_by IN ('user', 'summarizer', 'weekly_update')),
  review_status TEXT NOT NULL DEFAULT 'proposed' CHECK (review_status IN ('proposed', 'approved', 'corrected', 'rejected', 'superseded')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  CHECK (story_id IS NOT NULL OR character_id IS NOT NULL),
  UNIQUE(story_id, character_id, relationship_id, summary_type, version_number)
) STRICT;

CREATE TABLE IF NOT EXISTS summary_sources (
  summary_id INTEGER NOT NULL REFERENCES summary_versions(id) ON DELETE CASCADE,
  source_summary_id INTEGER REFERENCES summary_versions(id) ON DELETE CASCADE,
  source_conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
  source_message_start_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  source_message_end_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  PRIMARY KEY(summary_id, source_summary_id, source_conversation_id, source_message_start_id),
  CHECK (source_summary_id IS NOT NULL OR source_conversation_id IS NOT NULL)
) STRICT;

CREATE TABLE IF NOT EXISTS contradiction_reports (
  id INTEGER PRIMARY KEY,
  story_id INTEGER REFERENCES stories(id) ON DELETE CASCADE,
  left_memory_id INTEGER REFERENCES memory_items(id) ON DELETE CASCADE,
  right_memory_id INTEGER REFERENCES memory_items(id) ON DELETE CASCADE,
  summary_id INTEGER REFERENCES summary_versions(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('timeline', 'fact', 'personality', 'relationship', 'scene', 'intent')),
  description TEXT NOT NULL,
  severity INTEGER NOT NULL DEFAULT 3 CHECK (severity BETWEEN 1 AND 5),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'confirmed', 'dismissed', 'resolved')),
  suggested_resolution TEXT NOT NULL DEFAULT '',
  resolution_note TEXT NOT NULL DEFAULT '',
  detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  CHECK (left_memory_id IS NOT NULL OR summary_id IS NOT NULL)
) STRICT;

CREATE TABLE IF NOT EXISTS weekly_update_runs (
  id INTEGER PRIMARY KEY,
  story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'awaiting_review', 'completed', 'failed')),
  proposed_memory_count INTEGER NOT NULL DEFAULT 0,
  contradiction_count INTEGER NOT NULL DEFAULT 0,
  output_summary_id INTEGER REFERENCES summary_versions(id) ON DELETE SET NULL,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  UNIQUE(story_id, period_start, period_end)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_order ON messages(conversation_id, sequence_number);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages(sent_at);
CREATE INDEX IF NOT EXISTS idx_threads_story_status ON story_threads(story_id, status);
CREATE INDEX IF NOT EXISTS idx_scene_story_version ON scene_state_versions(story_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_state_story_character_version ON character_state_versions(story_id, character_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_memory_scope_review ON memory_items(story_id, character_id, review_status, lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_memory_importance ON memory_items(importance DESC, emotional_weight DESC);
CREATE INDEX IF NOT EXISTS idx_summaries_scope_version ON summary_versions(story_id, character_id, summary_type, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_contradictions_open ON contradiction_reports(story_id, status, severity DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_summary_version_scope_unique ON summary_versions(
  COALESCE(story_id, -1),
  COALESCE(character_id, -1),
  COALESCE(relationship_id, -1),
  summary_type,
  version_number
);

CREATE VIEW IF NOT EXISTS current_character_core AS
SELECT c.id AS character_id, c.name, v.*
FROM characters c
JOIN character_core_versions v ON v.character_id = c.id
WHERE v.review_status IN ('approved', 'corrected')
  AND v.version_number = (
    SELECT MAX(v2.version_number)
    FROM character_core_versions v2
    WHERE v2.character_id = c.id
      AND v2.review_status IN ('approved', 'corrected')
  );

CREATE VIEW IF NOT EXISTS current_character_state AS
SELECT v.*
FROM character_state_versions v
WHERE v.review_status IN ('approved', 'corrected')
  AND v.version_number = (
    SELECT MAX(v2.version_number)
    FROM character_state_versions v2
    WHERE v2.story_id = v.story_id
      AND v2.character_id = v.character_id
      AND v2.review_status IN ('approved', 'corrected')
  );

CREATE VIEW IF NOT EXISTS current_scene_state AS
SELECT v.*
FROM scene_state_versions v
WHERE v.version_number = (
  SELECT MAX(v2.version_number)
  FROM scene_state_versions v2
  WHERE v2.story_id = v.story_id
);

CREATE VIEW IF NOT EXISTS approved_memories AS
SELECT *
FROM memory_items
WHERE review_status IN ('approved', 'corrected')
  AND lifecycle_status = 'active';

CREATE VIEW IF NOT EXISTS pending_memory_review AS
SELECT m.*, COUNT(ms.message_id) AS source_count
FROM memory_items m
LEFT JOIN memory_sources ms ON ms.memory_id = m.id
WHERE m.review_status = 'proposed'
GROUP BY m.id;

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  title,
  content,
  keywords,
  content='memory_items',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memory_items BEGIN
  INSERT INTO memories_fts(rowid, title, content, keywords)
  VALUES (new.id, new.title, new.content, new.keywords);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memory_items BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content, keywords)
  VALUES ('delete', old.id, old.title, old.content, old.keywords);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memory_items BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content, keywords)
  VALUES ('delete', old.id, old.title, old.content, old.keywords);
  INSERT INTO memories_fts(rowid, title, content, keywords)
  VALUES (new.id, new.title, new.content, new.keywords);
END;

INSERT INTO app_meta(key, value)
VALUES ('schema_version', '1')
ON CONFLICT(key) DO NOTHING;
