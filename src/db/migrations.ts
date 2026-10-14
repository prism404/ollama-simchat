import type { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

export function migrateDatabase(db: DatabaseSync) {
  const version = db
    .prepare("SELECT value FROM app_meta WHERE key = 'schema_version'")
    .get()?.value;
  if (version !== "1" && version !== "2") {
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
}
