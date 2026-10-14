import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { migrateDatabase } from "./migrations.ts";
import { databasePath, openDatabase } from "./connection.ts";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(currentDirectory, "schema.sql"), "utf8");
const db = openDatabase();

try {
  db.exec("BEGIN IMMEDIATE");
  db.exec(schema);
  migrateDatabase(db);
  db.exec("COMMIT");
  console.log(`Database initialized: ${databasePath}`);
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}
