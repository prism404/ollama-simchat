import { openDatabase } from "./connection.ts";
import {
  MemoryWorkflowError,
  parsePositiveId,
} from "../memory/memory-types.ts";
import type { DatabaseSync } from "node:sqlite";
function scope(db: DatabaseSync, conversationId: number) {
  parsePositiveId(String(conversationId));
  const row = db
    .prepare(
      `SELECT conv.id AS conversationId,conv.story_id AS storyId,r.id AS relationshipId,c.id AS characterId,c.name AS characterName,p.id AS personaId,p.name AS personaName,p.avatar_path AS personaAvatarUrl,p.avatar_crop_json AS personaAvatarCrop
    FROM conversations conv JOIN story_cast member ON member.story_id=conv.story_id
    JOIN characters c ON c.id=member.character_id JOIN story_personas sp ON sp.story_id=conv.story_id JOIN personas p ON p.id=sp.persona_id
    JOIN relationships r ON r.story_id=conv.story_id AND r.character_id=c.id AND r.persona_id=p.id
    WHERE conv.id=? ORDER BY CASE WHEN member.role='main' THEN 0 ELSE 1 END,p.is_default DESC,c.id,p.id LIMIT 1`,
    )
    .get(conversationId);
  if (!row)
    throw new MemoryWorkflowError(404, "Histoire introuvable ou incomplète.");
  return row;
}
const parse = (value: unknown): Record<string, unknown> => {
  try {
    const item = JSON.parse(String(value));
    return item && typeof item === "object" && !Array.isArray(item) ? item : {};
  } catch {
    return {};
  }
};
function setup(db: DatabaseSync, storyId: unknown, relationshipId: unknown) {
  return db
    .prepare(
      "SELECT * FROM story_setup_versions WHERE story_id=? AND relationship_id=? ORDER BY version_number DESC",
    )
    .all(storyId as number, relationshipId as number)
    .map((row) => ({
      version: Number(row.version_number),
      form: parse(row.snapshot_json),
      createdAt: row.created_at,
      reason: row.reason,
    }));
}
function scenes(db: DatabaseSync, storyId: unknown) {
  return db
    .prepare(
      "SELECT * FROM scene_state_versions WHERE story_id=? ORDER BY version_number DESC",
    )
    .all(storyId as number)
    .map((row) => ({
      version: Number(row.version_number),
      createdAt: row.created_at,
      form: {
        location: String(row.location ?? ""),
        scene: String(row.current_action ?? ""),
        atmosphere: String(row.atmosphere ?? ""),
        summary: String(parse(row.state_json).continuitySummary ?? ""),
      },
    }));
}
export function getStory(conversationId: number) {
  const db = openDatabase();
  try {
    db.exec("BEGIN");
    const context = scope(db, conversationId);
    const initial = setup(db, context.storyId, context.relationshipId);
    const current = scenes(db, context.storyId);
    const result = {
      ...context,
      personaAvatarUrl:
        typeof context.personaAvatarUrl === "string" &&
        /^\/api\/persona-images\/\d+$/.test(context.personaAvatarUrl)
          ? context.personaAvatarUrl
          : null,
      personaAvatarCrop: parse(context.personaAvatarCrop),
      initial: initial[0] ?? null,
      initialVersions: initial,
      current: current[0] ?? null,
      currentVersions: current,
    };
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}
export function saveStory(conversationId: number, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new MemoryWorkflowError(400, "Objet histoire invalide.");
  const body = value as Record<string, unknown>;
  const section = body.section;
  if (section !== "setup" && section !== "current")
    throw new MemoryWorkflowError(400, "Section invalide.");
  const keys =
    section === "setup"
      ? ["title", "relationship", "initialContext", "location", "scene"]
      : ["location", "scene", "atmosphere", "summary"];
  if (
    Object.keys(body).some(
      (key) => !["section", "expectedVersion", ...keys].includes(key),
    )
  )
    throw new MemoryWorkflowError(400, "Champ d’histoire inconnu.");
  if (
    !Number.isSafeInteger(body.expectedVersion) ||
    Number(body.expectedVersion) < 0
  )
    throw new MemoryWorkflowError(400, "Version invalide.");
  const form: Record<string, string> = {};
  for (const key of keys) {
    if (
      typeof body[key] !== "string" ||
      (body[key] as string).length > (key === "title" ? 200 : 8000)
    )
      throw new MemoryWorkflowError(400, `Champ ${key} invalide.`);
    form[key] = (body[key] as string).trim();
  }
  if (section === "setup" && !form.title)
    throw new MemoryWorkflowError(400, "Le titre est obligatoire.");
  const db = openDatabase();
  try {
    db.exec("BEGIN IMMEDIATE");
    const context = scope(db, conversationId);
    const latest =
      section === "setup"
        ? setup(db, context.storyId, context.relationshipId)[0]
        : scenes(db, context.storyId)[0];
    if ((latest?.version ?? 0) !== body.expectedVersion)
      throw new MemoryWorkflowError(
        409,
        "Cette histoire a changé. Actualise avant d’enregistrer pour ne pas écraser une modification.",
      );
    const version = (latest?.version ?? 0) + 1;
    if (section === "setup") {
      db.prepare(
        "UPDATE stories SET title=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      ).run(form.title, context.storyId!);
      db.prepare(
        "UPDATE relationships SET current_label=?,initial_context=? WHERE id=?",
      ).run(form.relationship, form.initialContext, context.relationshipId!);
      db.prepare(
        "INSERT INTO story_setup_versions(story_id,relationship_id,version_number,snapshot_json,reason) VALUES(?,?,?,?,?)",
      ).run(
        context.storyId!,
        context.relationshipId!,
        version,
        JSON.stringify(form),
        "Correction manuelle du point de départ",
      );
    } else {
      const previous = db
        .prepare(
          "SELECT * FROM scene_state_versions WHERE story_id=? ORDER BY version_number DESC LIMIT 1",
        )
        .get(context.storyId!);
      db.prepare(
        `INSERT INTO scene_state_versions(story_id,version_number,previous_version_id,source_conversation_id,location,story_datetime,present_character_ids_json,current_action,atmosphere,open_question,state_json,created_by)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,'user')`,
      ).run(
        context.storyId!,
        version,
        previous?.id ?? null,
        conversationId,
        form.location,
        previous?.story_datetime ?? null,
        previous?.present_character_ids_json ??
          JSON.stringify([context.characterId]),
        form.scene,
        form.atmosphere,
        previous?.open_question ?? "",
        JSON.stringify({
          ...parse(previous?.state_json),
          continuitySummary: form.summary,
        }),
      );
    }
    db.exec("COMMIT");
    return { version };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}
