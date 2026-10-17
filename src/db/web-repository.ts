import { openDatabase } from "./connection.ts";
import { MemoryWorkflowError } from "../memory/memory-types.ts";

export function listConversations() {
  const db = openDatabase();
  try {
    return db
      .prepare(
        `SELECT c.id, c.title, c.status, s.title AS storyTitle
      FROM conversations c JOIN stories s ON s.id = c.story_id
      ORDER BY c.started_at DESC, c.id DESC`,
      )
      .all();
  } finally {
    db.close();
  }
}

export function listConversationMessages(conversationId: number) {
  const db = openDatabase();
  try {
    if (
      !db
        .prepare("SELECT id FROM conversations WHERE id = ?")
        .get(conversationId)
    ) {
      throw new MemoryWorkflowError(404, "Conversation introuvable.");
    }
    return db
      .prepare(
        `SELECT m.id, m.sender_type AS senderType, m.content,
      m.sequence_number AS sequenceNumber FROM messages m
      WHERE m.conversation_id = ? AND NOT EXISTS (
        SELECT 1 FROM messages correction WHERE correction.supersedes_message_id = m.id)
      ORDER BY m.sequence_number, m.id`,
      )
      .all(conversationId);
  } finally {
    db.close();
  }
}
