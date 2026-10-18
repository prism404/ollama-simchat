import type { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

export function migrateDatabase(db: DatabaseSync) {
  const version = db
    .prepare("SELECT value FROM app_meta WHERE key = 'schema_version'")
    .get()?.value;
  if (
    version !== "1" &&
    version !== "2" &&
    version !== "3" &&
    version !== "4"
  ) {
    throw new Error(
      `Version de schéma non prise en charge : ${String(version)}`,
    );
  }
  if (version === "1") {
    db.exec(
      readFileSync(
        new URL("./migrations/002-memory-review.sql", import.meta.url),
        "utf8",
      ),
    );
    db.prepare(
      "UPDATE app_meta SET value = '2', updated_at = CURRENT_TIMESTAMP WHERE key = 'schema_version'",
    ).run();
  }

  if (version === "1" || version === "2") {
    db.exec(
      readFileSync(
        new URL("./migrations/003-character-images.sql", import.meta.url),
        "utf8",
      ),
    );
    db.prepare(
      "UPDATE app_meta SET value = '3', updated_at = CURRENT_TIMESTAMP WHERE key = 'schema_version'",
    ).run();
  }
  if (version !== "4") {
    db.exec(
      readFileSync(
        new URL("./migrations/004-avatar-crop.sql", import.meta.url),
        "utf8",
      ),
    );
    db.prepare(
      "UPDATE app_meta SET value = '4', updated_at = CURRENT_TIMESTAMP WHERE key = 'schema_version'",
    ).run();
  }
}
