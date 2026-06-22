import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

// 1) Apply the canonical schema (idempotent: CREATE TABLE IF NOT EXISTS).
// 2) Apply ordered migrations in db/migrations/*.sql (also idempotent).
async function run() {
  const schema = fs.readFileSync(path.join(root, "schema.sql"), "utf8");
  await pool.query(schema);
  console.log("✓ schema applied");

  const migDir = path.join(__dirname, "migrations");
  if (fs.existsSync(migDir)) {
    const files = fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      const sql = fs.readFileSync(path.join(migDir, f), "utf8");
      await pool.query(sql);
      console.log(`✓ migration ${f} applied`);
    }
  }
  console.log("✓ database up to date");
}

try {
  await run();
} catch (e) {
  console.error("✗ Migration failed:", e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
