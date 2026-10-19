CREATE TABLE story_setup_versions (
  id INTEGER PRIMARY KEY,
  story_id INTEGER NOT NULL REFERENCES stories(id),
  relationship_id INTEGER NOT NULL REFERENCES relationships(id),
  version_number INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(story_id,relationship_id,version_number)
) STRICT;
INSERT INTO story_setup_versions(story_id,relationship_id,version_number,snapshot_json,reason,created_at)
SELECT s.id,r.id,1,json_object('title',s.title,'relationship',r.current_label,'initialContext',r.initial_context,
 'location',COALESCE((SELECT location FROM scene_state_versions WHERE story_id=s.id ORDER BY version_number LIMIT 1),''),
 'scene',COALESCE((SELECT current_action FROM scene_state_versions WHERE story_id=s.id ORDER BY version_number LIMIT 1),'')),
 'Contexte existant conservé lors de la migration',s.created_at
FROM stories s JOIN relationships r ON r.story_id=s.id;
CREATE INDEX IF NOT EXISTS idx_messages_supersedes ON messages(supersedes_message_id);
