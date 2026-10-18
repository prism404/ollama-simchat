import { validatePersonaProfile } from "../persona/persona-profile.ts";
import { openDatabase } from "./connection.ts";
import {
  MemoryWorkflowError,
  parsePositiveId,
} from "../memory/memory-types.ts";
function body(value: unknown, keys: string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    throw new MemoryWorkflowError(400, "Champs invalides.");
  return value as Record<string, unknown>;
}
export function archiveCharacter(id: number, value: unknown, restore = false) {
  parsePositiveId(String(id));
  const input = body(value, ["confirmation"]);
  const db = openDatabase();
  try {
    db.exec("BEGIN IMMEDIATE");
    const character = db
      .prepare("SELECT name FROM characters WHERE id=?")
      .get(id);
    if (!character)
      throw new MemoryWorkflowError(404, "Personnage introuvable.");
    if (input.confirmation !== character.name)
      throw new MemoryWorkflowError(
        400,
        "Recopie exactement le nom du personnage pour confirmer.",
      );
    db.prepare(
      "UPDATE characters SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    ).run(restore ? "active" : "archived", id);
    db.exec("COMMIT");
    return { id, archived: !restore };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}
export function savePersona(value: unknown, id?: number) {
  if (id !== undefined) parsePositiveId(String(id));
  const input = body(value, [
    "name",
    "pronouns",
    "description",
    "isDefault",
    "profile",
  ]);
  let profile;
  if (input.profile !== undefined) {
    try {
      profile = validatePersonaProfile(input.profile);
    } catch (error) {
      throw new MemoryWorkflowError(400, (error as Error).message);
    }
  }
  for (const [key, max] of [
    ["name", 100],
    ["pronouns", 100],
    ["description", 8000],
  ] as const) {
    if (
      typeof input[key] !== "string" ||
      (input[key] as string).length > max ||
      (key === "name" && !(input[key] as string).trim())
    )
      throw new MemoryWorkflowError(400, `Champ ${key} invalide.`);
  }
  if (typeof input.isDefault !== "boolean")
    throw new MemoryWorkflowError(400, "Choix par défaut invalide.");
  const db = openDatabase();
  try {
    db.exec("BEGIN IMMEDIATE");
    if (
      id !== undefined &&
      !db.prepare("SELECT id FROM personas WHERE id=?").get(id)
    )
      throw new MemoryWorkflowError(404, "Persona introuvable.");
    if (input.isDefault)
      db.prepare("UPDATE personas SET is_default=0 WHERE is_default=1").run();
    const args = [
      (input.name as string).trim(),
      (input.pronouns as string).trim(),
      (input.description as string).trim(),
      input.isDefault ? 1 : 0,
    ];
    if (id === undefined)
      id = Number(
        db
          .prepare(
            "INSERT INTO personas(name,pronouns,description,is_default) VALUES(?,?,?,?)",
          )
          .run(...args).lastInsertRowid,
      );
    else
      db.prepare(
        "UPDATE personas SET name=?,pronouns=?,description=?,is_default=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      ).run(...args, id);
    if (profile !== undefined) {
      const row = db
        .prepare("SELECT preferences_json FROM personas WHERE id=?")
        .get(id);
      let preferences: Record<string, unknown> = {};
      try {
        const data = JSON.parse(String(row?.preferences_json));
        if (data && typeof data === "object" && !Array.isArray(data))
          preferences = data;
      } catch {
        /* Anciennes préférences absentes ou invalides. */
      }
      db.prepare("UPDATE personas SET preferences_json=? WHERE id=?").run(
        JSON.stringify({ ...preferences, profile }),
        id,
      );
    }
    db.exec("COMMIT");
    return { id };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}
