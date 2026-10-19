import { openDatabase } from "./connection.ts";
import { MemoryWorkflowError } from "../memory/memory-types.ts";

export function listConversations() {
  const db = openDatabase();
  try {
    return db
      .prepare(
        `WITH owned AS (
        SELECT c.*, (SELECT member.character_id FROM story_cast AS member
          JOIN current_character_core core ON core.character_id = member.character_id
          WHERE member.story_id = c.story_id
          ORDER BY CASE WHEN member.role = 'main' THEN 0 ELSE 1 END,
            member.character_id ASC LIMIT 1) AS characterId
        FROM conversations c
      )
      SELECT c.id, c.title, c.status, c.characterId, character.name AS characterName,
        s.title AS storyTitle, persona.name AS personaName, persona.avatar_path AS personaAvatarUrl, persona.avatar_crop_json AS personaAvatarCrop FROM owned c
      JOIN stories s ON s.id = c.story_id
      LEFT JOIN characters character ON character.id = c.characterId
      LEFT JOIN personas persona ON persona.id=(SELECT p.id FROM story_personas sp JOIN personas p ON p.id=sp.persona_id WHERE sp.story_id=c.story_id ORDER BY p.is_default DESC,p.id ASC LIMIT 1)
      WHERE character.status IS NULL OR character.status != 'archived'
      ORDER BY c.started_at DESC, c.id DESC`,
      )
      .all()
      .map((row) => ({
        ...row,
        personaAvatarUrl:
          typeof row.personaAvatarUrl === "string" &&
          /^\/api\/persona-images\/\d+$/.test(row.personaAvatarUrl)
            ? row.personaAvatarUrl
            : null,
        personaAvatarCrop: parseCrop(row.personaAvatarCrop),
      }));
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
      m.sequence_number AS sequenceNumber,
      CASE WHEN m.sender_type='persona' THEN p.name WHEN m.sender_type='character' THEN c.name END AS authorName,
      CASE WHEN m.sender_type='persona' THEN p.avatar_path WHEN m.sender_type='character' THEN c.avatar_path END AS avatarUrl,
      CASE WHEN m.sender_type='persona' THEN p.avatar_crop_json WHEN m.sender_type='character' THEN c.avatar_crop_json END AS avatarCrop
      FROM messages m LEFT JOIN personas p ON p.id=m.persona_id LEFT JOIN characters c ON c.id=m.character_id
      WHERE m.conversation_id = ? AND NOT EXISTS (
        SELECT 1 FROM messages correction WHERE correction.supersedes_message_id = m.id)
      ORDER BY m.sequence_number, m.id`,
      )
      .all(conversationId)
      .map((row) => ({
        ...row,
        avatarUrl:
          typeof row.avatarUrl === "string" &&
          /^\/api\/(?:character|persona)-images\/\d+$/.test(row.avatarUrl)
            ? row.avatarUrl
            : null,
        avatarCrop: parseCrop(row.avatarCrop),
      }));
  } finally {
    db.close();
  }
}

function parseCrop(value: unknown) {
  try {
    const crop = JSON.parse(String(value));
    if (
      crop &&
      [crop.x, crop.y, crop.zoom].every(
        (v) => typeof v === "number" && Number.isFinite(v),
      ) &&
      crop.x >= 0 &&
      crop.x <= 100 &&
      crop.y >= 0 &&
      crop.y <= 100 &&
      crop.zoom >= 1 &&
      crop.zoom <= 3
    )
      return crop;
    return { x: 50, y: 50, zoom: 1 };
  } catch {
    return { x: 50, y: 50, zoom: 1 };
  }
}
