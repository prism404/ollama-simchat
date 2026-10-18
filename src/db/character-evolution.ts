import { openDatabase } from "./connection.ts";
import {
  MemoryWorkflowError,
  parsePositiveId,
} from "../memory/memory-types.ts";
import type { DatabaseSync } from "node:sqlite";
function scope(db: DatabaseSync, characterId: number, storyId: number) {
  parsePositiveId(String(characterId));
  parsePositiveId(String(storyId));
  const row = db
    .prepare(
      `SELECT story.id AS storyId, story.title, persona.id AS personaId,
    relationship.id AS relationshipId FROM stories story
    JOIN story_cast cast_member ON cast_member.story_id = story.id AND cast_member.character_id = ?
    JOIN story_personas sp ON sp.story_id = story.id JOIN personas persona ON persona.id = sp.persona_id
    LEFT JOIN relationships relationship ON relationship.story_id = story.id AND relationship.character_id = cast_member.character_id AND relationship.persona_id = persona.id
    WHERE story.id = ? ORDER BY persona.is_default DESC, persona.id ASC LIMIT 1`,
    )
    .get(characterId, storyId);
  if (!row)
    throw new MemoryWorkflowError(
      404,
      "Cette histoire n’appartient pas à ce personnage ou est incomplète.",
    );
  return row;
}
function state(row: Record<string, unknown>) {
  const parse = (value: unknown) => {
    try {
      return JSON.parse(String(value));
    } catch {
      return {};
    }
  };
  const record = (value: unknown) => {
    const data = parse(value);
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  };
  const list = (value: unknown) => {
    const data = parse(value);
    return Array.isArray(data)
      ? data.filter((item) => typeof item === "string")
      : [];
  };
  return {
    id: row.id,
    version: row.version_number,
    summary: row.development_summary,
    mood: record(row.mood_json),
    goals: list(row.current_goals_json),
    relationship: record(row.relationship_state_json),
    lessons: list(row.learned_lessons_json),
    createdAt: row.created_at,
    reason: row.change_reason,
  };
}
export function getCharacterEvolution(characterId: number, storyId?: number) {
  parsePositiveId(String(characterId));
  const db = openDatabase();
  try {
    db.exec("BEGIN");
    if (!db.prepare("SELECT id FROM characters WHERE id = ?").get(characterId))
      throw new MemoryWorkflowError(404, "Personnage introuvable.");
    const stories = db
      .prepare(
        `SELECT story.id, story.title FROM stories story JOIN story_cast member ON member.story_id = story.id WHERE member.character_id = ? ORDER BY story.id DESC`,
      )
      .all(characterId);
    const initial = db
      .prepare(
        `SELECT version_number AS version, created_at AS createdAt, identity_json AS identity
      FROM character_core_versions WHERE character_id = ? AND review_status IN ('approved','corrected') ORDER BY version_number LIMIT 1`,
      )
      .get(characterId);
    if (storyId === undefined) {
      db.exec("COMMIT");
      return {
        stories,
        initial,
        selectedStoryId: null,
        current: null,
        states: [],
        memories: [],
        activity: null,
      };
    }
    const context = scope(db, characterId, storyId);
    const states = db
      .prepare(
        `SELECT * FROM character_state_versions WHERE character_id = ? AND story_id = ? AND relationship_id IS ? AND review_status IN ('approved','corrected') ORDER BY version_number DESC`,
      )
      .all(characterId, storyId, context.relationshipId!)
      .map(state);
    const memories = db
      .prepare(
        `SELECT m.id,m.title,m.content,m.scope,m.review_status AS status,m.reviewed_at AS reviewedAt,m.created_at AS createdAt,
      (SELECT COUNT(*) FROM memory_sources source WHERE source.memory_id = m.id) AS sourceCount
      FROM memory_items m WHERE m.review_status IN ('approved','corrected') AND m.lifecycle_status = 'active'
      AND ((m.scope = 'global_character' AND m.character_id = ?) OR (m.scope = 'story' AND m.story_id = ?)
        OR (m.scope = 'persona' AND m.persona_id = ?) OR (m.scope = 'relationship' AND m.relationship_id = ?))
      AND (m.story_id IS NULL OR m.story_id = ?) AND (m.character_id IS NULL OR m.character_id = ?)
      AND (m.persona_id IS NULL OR m.persona_id = ?) AND (m.relationship_id IS NULL OR m.relationship_id = ?)
      ORDER BY COALESCE(m.reviewed_at,m.created_at) DESC,m.id DESC LIMIT 100`,
      )
      .all(
        characterId,
        storyId,
        context.personaId!,
        context.relationshipId!,
        storyId,
        characterId,
        context.personaId!,
        context.relationshipId!,
      );
    const activity = db
      .prepare(
        `SELECT COUNT(*) AS messageCount,MIN(m.sent_at) AS firstMessageAt,MAX(m.sent_at) AS lastMessageAt
      FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.story_id = ?
      AND (m.character_id IS NULL OR m.character_id = ?) AND (m.persona_id IS NULL OR m.persona_id = ?)
      AND NOT EXISTS(SELECT 1 FROM messages correction WHERE correction.supersedes_message_id = m.id)`,
      )
      .get(storyId, characterId, context.personaId!);
    db.exec("COMMIT");
    return {
      stories,
      initial,
      selectedStoryId: storyId,
      current: states[0] ?? null,
      states,
      memories,
      activity,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}
export function saveCharacterEvolution(characterId: number, value: unknown) {
  const body = value as Record<string, unknown>;
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some(
      (key) =>
        ![
          "storyId",
          "summary",
          "mood",
          "goals",
          "relationship",
          "lessons",
        ].includes(key),
    )
  )
    throw new MemoryWorkflowError(400, "État du personnage invalide.");
  if (
    typeof body.storyId !== "number" ||
    !Number.isSafeInteger(body.storyId) ||
    body.storyId <= 0
  )
    throw new MemoryWorkflowError(400, "Histoire invalide.");
  const text = (key: string, max = 2000) => {
    if (body[key] === undefined && key !== "summary") return "";
    if (typeof body[key] !== "string" || (body[key] as string).length > max)
      throw new MemoryWorkflowError(400, `Champ ${key} invalide.`);
    return (body[key] as string).trim();
  };
  const summary = text("summary", 3000),
    mood = text("mood"),
    goals = text("goals"),
    relationship = text("relationship"),
    lessons = text("lessons");
  if (!summary)
    throw new MemoryWorkflowError(400, "Le bilan d’évolution est obligatoire.");
  const lines = (value: string) =>
    value
      .split("\n")
      .map((v) => v.trim())
      .filter(Boolean);
  const db = openDatabase();
  try {
    db.exec("BEGIN IMMEDIATE");
    const context = scope(db, characterId, body.storyId);
    const previous = db
      .prepare(
        `SELECT id FROM character_state_versions WHERE character_id = ? AND story_id = ? AND relationship_id IS ? AND review_status IN ('approved','corrected') ORDER BY version_number DESC LIMIT 1`,
      )
      .get(characterId, body.storyId, context.relationshipId!);
    const version = Number(
      db
        .prepare(
          "SELECT COALESCE(MAX(version_number),0)+1 AS version FROM character_state_versions WHERE character_id = ? AND story_id = ?",
        )
        .get(characterId, body.storyId)?.version,
    );
    db.prepare(
      `INSERT INTO character_state_versions(story_id,character_id,relationship_id,version_number,previous_version_id,
      mood_json,current_goals_json,relationship_state_json,learned_lessons_json,development_summary,change_reason,created_by,review_status,reviewed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?, 'Bilan manuel validé par l’utilisatrice','user','approved',CURRENT_TIMESTAMP)`,
    ).run(
      body.storyId,
      characterId,
      context.relationshipId!,
      version,
      previous?.id ?? null,
      JSON.stringify({ description: mood }),
      JSON.stringify(lines(goals)),
      JSON.stringify({ description: relationship }),
      JSON.stringify(lines(lessons)),
      summary,
    );
    db.exec("COMMIT");
    return { version };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}
