import { openDatabase } from "./connection.ts";
import { MemoryWorkflowError } from "../memory/memory-types.ts";

export type MediaOwner = "character" | "persona";
// SQL identifiers come only from this fixed map, never from request values.
function mediaTables(owner: MediaOwner) {
  return owner === "persona"
    ? {
        profiles: "personas",
        images: "persona_images",
        foreignKey: "persona_id",
        prefix: "persona-images",
        label: "persona",
      }
    : {
        profiles: "characters",
        images: "character_images",
        foreignKey: "character_id",
        prefix: "character-images",
        label: "personnage",
      };
}
function requireProfile(
  db: ReturnType<typeof openDatabase>,
  id: number,
  owner: MediaOwner,
) {
  const media = mediaTables(owner);
  if (!db.prepare(`SELECT id FROM ${media.profiles} WHERE id = ?`).get(id))
    throw new MemoryWorkflowError(404, `${media.label} introuvable.`);
}
export function listProfileImages(id: number, owner: MediaOwner = "character") {
  const media = mediaTables(owner);
  const db = openDatabase();
  try {
    requireProfile(db, id, owner);
    return db
      .prepare(
        `SELECT i.id, i.name, '/api/${media.prefix}/' || i.id AS url,
      CASE WHEN c.avatar_path = '/api/${media.prefix}/' || i.id THEN 1 ELSE 0 END AS isAvatar, c.avatar_crop_json AS avatarCrop
      FROM ${media.images} i JOIN ${media.profiles} c ON c.id = i.${media.foreignKey} WHERE i.${media.foreignKey} = ? ORDER BY i.id`,
      )
      .all(id);
  } finally {
    db.close();
  }
}
export function saveProfileImage(
  id: number,
  value: unknown,
  owner: MediaOwner = "character",
) {
  const media = mediaTables(owner);
  const body = value as { name?: unknown; dataUrl?: unknown } | null;
  if (
    !body ||
    typeof body.name !== "string" ||
    !body.name.trim() ||
    body.name.length > 150 ||
    typeof body.dataUrl !== "string"
  )
    throw new MemoryWorkflowError(400, "Image ou nom invalide.");
  const { bytes, mime } = decodeImageDataUrl(body.dataUrl);
  const db = openDatabase();
  try {
    db.exec("BEGIN IMMEDIATE");
    requireProfile(db, id, owner);
    if (
      Number(
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM ${media.images} WHERE ${media.foreignKey} = ?`,
          )
          .get(id)?.n,
      ) >= 20
    )
      throw new MemoryWorkflowError(
        400,
        `Maximum 20 images par ${media.label} pour cette version.`,
      );
    const imageId = Number(
      db
        .prepare(
          `INSERT INTO ${media.images}(${media.foreignKey},name,mime_type,image_data) VALUES(?,?,?,?)`,
        )
        .run(id, body.name.trim(), mime, bytes).lastInsertRowid,
    );
    db.exec("COMMIT");
    return { id: imageId, url: `/api/${media.prefix}/${imageId}` };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}
export function setProfileAvatar(
  id: number,
  imageId: number,
  crop: unknown = { x: 50, y: 50, zoom: 1 },
  owner: MediaOwner = "character",
) {
  const media = mediaTables(owner);
  const value = crop as { x: number; y: number; zoom: number };
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !["x", "y", "zoom"].includes(k)) ||
    ![value.x, value.y, value.zoom].every(
      (v) => typeof v === "number" && Number.isFinite(v),
    ) ||
    value.x < 0 ||
    value.x > 100 ||
    value.y < 0 ||
    value.y > 100 ||
    value.zoom < 1 ||
    value.zoom > 3
  )
    throw new MemoryWorkflowError(400, "Cadrage invalide.");
  const db = openDatabase();
  try {
    db.exec("BEGIN IMMEDIATE");
    requireProfile(db, id, owner);
    if (
      !db
        .prepare(
          `SELECT id FROM ${media.images} WHERE id = ? AND ${media.foreignKey} = ?`,
        )
        .get(imageId, id)
    )
      throw new MemoryWorkflowError(
        404,
        `Cette image n’appartient pas au ${media.label}.`,
      );
    db.prepare(
      `UPDATE ${media.profiles} SET avatar_path = ?, avatar_crop_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(`/api/${media.prefix}/${imageId}`, JSON.stringify(value), id);
    db.exec("COMMIT");
    return { avatarUrl: `/api/${media.prefix}/${imageId}` };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}
export function getProfileImage(id: number, owner: MediaOwner = "character") {
  const media = mediaTables(owner);
  const db = openDatabase();
  try {
    const row = db
      .prepare(`SELECT mime_type, image_data FROM ${media.images} WHERE id = ?`)
      .get(id);
    if (!row) throw new MemoryWorkflowError(404, "Image introuvable.");
    return row;
  } finally {
    db.close();
  }
}

// Existing imports retain character-only defaults.
export {
  listProfileImages as listCharacterImages,
  saveProfileImage as saveCharacterImage,
  setProfileAvatar as setCharacterAvatar,
  getProfileImage as getCharacterImage,
};

export function decodeImageDataUrl(dataUrl: string) {
  const match = dataUrl.match(
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/,
  );
  if (!match || match[2].length > 7_000_000)
    throw new MemoryWorkflowError(
      400,
      "Choisis une image PNG, JPEG ou WebP de 5 Mo maximum.",
    );
  const bytes = Buffer.from(match[2], "base64"),
    mime = match[1];
  const valid =
    mime === "image/png"
      ? bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mime === "image/jpeg"
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : bytes.toString("ascii", 0, 4) === "RIFF" &&
          bytes.toString("ascii", 8, 12) === "WEBP";
  if (!valid || bytes.length > 5 * 1024 * 1024)
    throw new MemoryWorkflowError(
      400,
      "Format d’image invalide ou fichier trop volumineux.",
    );
  return { bytes, mime };
}
