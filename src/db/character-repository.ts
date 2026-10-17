import { openDatabase } from "./connection.ts";
import {
  MemoryWorkflowError,
  parsePositiveId,
} from "../memory/memory-types.ts";
import type { DatabaseSync } from "node:sqlite";

export type CharacterForm = {
  name: string;
  pronouns: string;
  description: string;
  personality: string;
  values: string;
  motivations: string;
  tone: string;
  humor: string;
  responseLength: string;
  boundaries: string;
  exampleSituation: string;
  exampleUser: string;
  exampleReply: string;
};
const fields = [
  "name",
  "pronouns",
  "description",
  "personality",
  "values",
  "motivations",
  "tone",
  "humor",
  "responseLength",
  "boundaries",
  "exampleSituation",
  "exampleUser",
  "exampleReply",
] as const;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new MemoryWorkflowError(400, "Objet JSON attendu.");
  return value as Record<string, unknown>;
}
function text(
  body: Record<string, unknown>,
  field: string,
  required = false,
  max = 8000,
) {
  const value = body[field];
  if (value === undefined && !required) return "";
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new MemoryWorkflowError(
      400,
      `Champ ${field} invalide${required ? " ou manquant" : ""}.`,
    );
  return value.trim();
}
function parseForm(value: unknown): CharacterForm {
  const body = object(value);
  if (
    Object.keys(body).some(
      (key) => !(fields as readonly string[]).includes(key),
    )
  )
    throw new MemoryWorkflowError(400, "Champ de personnage inconnu.");
  const form = Object.fromEntries(
    fields.map((key) => [
      key,
      text(body, key, key === "name", key === "name" ? 100 : 8000),
    ]),
  ) as CharacterForm;
  const examples = [form.exampleSituation, form.exampleUser, form.exampleReply];
  if (examples.some(Boolean) && !examples.every(Boolean))
    throw new MemoryWorkflowError(
      400,
      "Renseigne les trois champs de l’exemple ou laisse-les tous vides.",
    );
  return form;
}
function json(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const result = JSON.parse(value);
    return result && typeof result === "object" && !Array.isArray(result)
      ? result
      : {};
  } catch {
    return {};
  }
}
const lines = (value: string) =>
  value
    .split(/\n|,/)
    .map((v) => v.trim())
    .filter(Boolean);
const read = (value: unknown): string =>
  typeof value === "string" ? value : "";
function listText(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((v) => typeof v === "string").join("\n")
      : "";
  } catch {
    return "";
  }
}
function requireCore(db: DatabaseSync, id: number) {
  parsePositiveId(String(id));
  const core = db
    .prepare(
      "SELECT core.* FROM current_character_core core JOIN characters c ON c.id = core.character_id WHERE core.character_id = ? AND c.status != 'archived'",
    )
    .get(id);
  if (!core)
    throw new MemoryWorkflowError(
      404,
      "Personnage introuvable ou fiche non validée.",
    );
  return core;
}
export function listCharacters() {
  const db = openDatabase();
  try {
    return db
      .prepare(
        `SELECT c.id, c.name, v.version_number AS version, v.identity_json AS identity
    FROM characters c JOIN current_character_core v ON v.character_id = c.id
    WHERE c.status != 'archived' ORDER BY c.id DESC`,
      )
      .all()
      .map((row) => ({
        id: row.id,
        name: row.name,
        version: row.version,
        description: read(json(row.identity).description),
      }));
  } finally {
    db.close();
  }
}
export function getCharacter(id: number) {
  const db = openDatabase();
  try {
    const core = requireCore(db, id);
    const identity = json(core.identity_json),
      personality = json(core.personality_json),
      speech = json(core.speech_style_json);
    const example = db
      .prepare(
        `SELECT * FROM character_dialogue_examples WHERE character_id = ?
      AND (core_version_id = ? OR (core_version_id IS NULL AND ? = 1)) ORDER BY priority DESC, id DESC LIMIT 1`,
      )
      .get(id, core.id!, core.version_number!);
    const form: CharacterForm = {
      name: read(core.name),
      pronouns: read(identity.pronouns),
      description: read(identity.description),
      personality: Array.isArray(personality.traits)
        ? personality.traits.filter((v) => typeof v === "string").join("\n")
        : read(personality.description),
      values: listText(core.values_json),
      motivations: listText(core.motivations_json),
      boundaries: listText(core.boundaries_json),
      tone: read(speech.tone) || read(speech.register),
      humor: read(speech.humor),
      responseLength: read(speech.responseLength),
      exampleSituation: read(example?.situation_description),
      exampleUser: read(example?.user_message),
      exampleReply: read(example?.ideal_response),
    };
    return {
      id,
      version: Number(core.version_number),
      form,
      versions: db
        .prepare(
          `SELECT version_number AS version, created_at AS createdAt, change_reason AS reason,
      identity_json AS identity FROM character_core_versions WHERE character_id = ? ORDER BY version_number DESC`,
        )
        .all(id)
        .map((row) => ({
          version: row.version,
          createdAt: row.createdAt,
          reason: row.reason,
          name: read(json(row.identity).name) || read(core.name),
        })),
    };
  } finally {
    db.close();
  }
}
export function saveCharacter(value: unknown, id?: number) {
  const form = parseForm(value);
  const db = openDatabase();
  try {
    db.exec("BEGIN IMMEDIATE");
    const previous = id === undefined ? undefined : requireCore(db, id);
    const characterId =
      id ??
      Number(
        db
          .prepare(
            "INSERT INTO characters(name, short_label, status) VALUES (?, ?, 'active')",
          )
          .run(form.name, form.description.slice(0, 120)).lastInsertRowid,
      );
    if (id !== undefined)
      db.prepare(
        "UPDATE characters SET name = ?, short_label = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      ).run(form.name, form.description.slice(0, 120), id);
    const version = Number(
      db
        .prepare(
          "SELECT COALESCE(MAX(version_number), 0) + 1 AS version FROM character_core_versions WHERE character_id = ?",
        )
        .get(characterId)?.version,
    );
    const coreFields = {
      identity_json: JSON.stringify({
        ...json(previous?.identity_json),
        name: form.name,
        pronouns: form.pronouns,
        description: form.description,
      }),
      appearance_json: previous?.appearance_json ?? "{}",
      biography_json: previous?.biography_json ?? "{}",
      personality_json: JSON.stringify({
        ...json(previous?.personality_json),
        traits: lines(form.personality),
      }),
      values_json: JSON.stringify(lines(form.values)),
      motivations_json: JSON.stringify(lines(form.motivations)),
      fears_json: previous?.fears_json ?? "[]",
      flaws_json: previous?.flaws_json ?? "[]",
      boundaries_json: JSON.stringify(lines(form.boundaries)),
      speech_style_json: JSON.stringify({
        ...json(previous?.speech_style_json),
        tone: form.tone,
        humor: form.humor,
        responseLength: form.responseLength,
      }),
      behavior_rules_json: previous?.behavior_rules_json ?? "[]",
      immutable_facts_json: previous?.immutable_facts_json ?? "[]",
    };
    const coreId = db
      .prepare(
        `INSERT INTO character_core_versions(character_id, version_number, ${Object.keys(coreFields).join(",")}, change_reason, created_by, review_status, reviewed_at)
      VALUES (?, ?, ${Object.keys(coreFields)
        .map(() => "?")
        .join(",")}, ?, 'user', 'approved', CURRENT_TIMESTAMP)`,
      )
      .run(
        characterId,
        version,
        ...Object.values(coreFields),
        previous
          ? "Modification manuelle de la fiche"
          : "Création manuelle de la fiche",
      ).lastInsertRowid;
    if (form.exampleReply)
      db.prepare(
        `INSERT INTO character_dialogue_examples(character_id, core_version_id, situation_key, situation_description, user_message, ideal_response, response_strategy)
      VALUES (?, ?, 'manual_example', ?, ?, ?, ?)`,
      ).run(
        characterId,
        coreId,
        form.exampleSituation,
        form.exampleUser,
        form.exampleReply,
        "Suivre le ton de cet exemple sans le traiter comme un souvenir.",
      );
    db.exec("COMMIT");
    return { id: characterId, version };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}
export function listPersonas() {
  const db = openDatabase();
  try {
    return db
      .prepare("SELECT id, name FROM personas ORDER BY is_default DESC, id ASC")
      .all();
  } finally {
    db.close();
  }
}
export function startStory(characterId: number, value: unknown) {
  const body = object(value);
  const allowed = [
    "title",
    "personaId",
    "personaName",
    "relationship",
    "initialContext",
    "location",
    "scene",
  ];
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    throw new MemoryWorkflowError(400, "Champ d’histoire inconnu.");
  const title = text(body, "title", true, 200),
    relationship = text(body, "relationship"),
    initialContext = text(body, "initialContext"),
    location = text(body, "location"),
    scene = text(body, "scene");
  const personaName = text(body, "personaName", false, 100);
  const personaId = body.personaId;
  if (
    personaId !== undefined &&
    (typeof personaId !== "number" ||
      !Number.isSafeInteger(personaId) ||
      personaId <= 0)
  )
    throw new MemoryWorkflowError(400, "Persona invalide.");
  if (
    (personaId !== undefined && personaName) ||
    (personaId === undefined && !personaName)
  )
    throw new MemoryWorkflowError(
      400,
      "Choisis un persona existant ou renseigne son nom.",
    );
  const db = openDatabase();
  try {
    db.exec("BEGIN IMMEDIATE");
    requireCore(db, characterId);
    if (
      personaId !== undefined &&
      !db.prepare("SELECT id FROM personas WHERE id = ?").get(personaId)
    )
      throw new MemoryWorkflowError(404, "Persona introuvable.");
    const selectedPersona =
      personaId ??
      Number(
        db.prepare("INSERT INTO personas(name) VALUES (?)").run(personaName)
          .lastInsertRowid,
      );
    const storyId = Number(
      db.prepare("INSERT INTO stories(title) VALUES (?)").run(title)
        .lastInsertRowid,
    );
    db.prepare(
      "INSERT INTO story_cast(story_id, character_id) VALUES (?, ?)",
    ).run(storyId, characterId);
    db.prepare(
      "INSERT INTO story_personas(story_id, persona_id) VALUES (?, ?)",
    ).run(storyId, selectedPersona);
    const relationId = db
      .prepare(
        "INSERT INTO relationships(story_id, character_id, persona_id, current_label, initial_context) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        storyId,
        characterId,
        selectedPersona,
        relationship,
        initialContext,
      ).lastInsertRowid;
    const conversationId = Number(
      db
        .prepare("INSERT INTO conversations(story_id, title) VALUES (?, ?)")
        .run(storyId, title).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO scene_state_versions(story_id, version_number, source_conversation_id, location, current_action, present_character_ids_json, created_by)
      VALUES (?, 1, ?, ?, ?, ?, 'user')`,
    ).run(
      storyId,
      conversationId,
      location,
      scene,
      JSON.stringify([characterId]),
    );
    db.exec("COMMIT");
    return { storyId, conversationId, relationshipId: Number(relationId) };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}
