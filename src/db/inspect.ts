import { databasePath, openDatabase } from "./connection.ts";

const db = openDatabase();

try {
  const tables = db
    .prepare(
      `
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'
    ORDER BY name
  `,
    )
    .all();

  console.log(`Database: ${databasePath}\n`);
  for (const table of tables) {
    const count = db
      .prepare(`SELECT COUNT(*) AS count FROM "${table.name}"`)
      .get();
    console.log(`${String(count?.count ?? 0).padStart(5, " ")}  ${table.name}`);
  }
} finally {
  db.close();
}
