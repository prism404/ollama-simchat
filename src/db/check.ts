import { databasePath, openDatabase } from "./connection.ts";

const db = openDatabase();

try {
  const integrity = db.prepare("PRAGMA integrity_check").get();
  const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
  const schemaVersion = db
    .prepare("SELECT value FROM app_meta WHERE key = 'schema_version'")
    .get();
  const tables = db
    .prepare(
      `
    SELECT COUNT(*) AS count
    FROM sqlite_master
    WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
  `,
    )
    .get();

  console.log(
    JSON.stringify(
      {
        database: databasePath,
        schemaVersion: schemaVersion?.value ?? null,
        integrity: integrity?.integrity_check ?? "unknown",
        foreignKeyErrors: foreignKeys.length,
        tableCount: tables?.count ?? 0,
      },
      null,
      2,
    ),
  );

  if (integrity?.integrity_check !== "ok" || foreignKeys.length > 0) {
    process.exitCode = 1;
  }
} finally {
  db.close();
}
