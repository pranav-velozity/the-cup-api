import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, "..", "schema.sql");

const sql = fs.readFileSync(schemaPath, "utf8");

try {
  await pool.query(sql);
  console.log("✓ Migration complete — all tables created.");
} catch (e) {
  console.error("✗ Migration failed:", e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
