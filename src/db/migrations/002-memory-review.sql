ALTER TABLE memory_items ADD COLUMN source_conversation_id INTEGER REFERENCES conversations(id);
ALTER TABLE memory_items ADD COLUMN proposal_key TEXT;
CREATE UNIQUE INDEX idx_memory_proposal_key ON memory_items(proposal_key) WHERE proposal_key IS NOT NULL;
CREATE INDEX idx_memory_source_conversation ON memory_items(source_conversation_id, review_status);
ALTER TABLE memory_reviews ADD COLUMN previous_title TEXT;
ALTER TABLE memory_reviews ADD COLUMN resulting_title TEXT;
