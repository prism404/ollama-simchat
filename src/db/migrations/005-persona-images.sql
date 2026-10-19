ALTER TABLE personas ADD COLUMN avatar_path TEXT;
ALTER TABLE personas ADD COLUMN avatar_crop_json TEXT NOT NULL DEFAULT '{"x":50,"y":50,"zoom":1}';
CREATE TABLE persona_images (
  id INTEGER PRIMARY KEY,
  persona_id INTEGER NOT NULL REFERENCES personas(id),
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  image_data BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX idx_persona_images_persona ON persona_images(persona_id, id);
