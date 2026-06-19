import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

// Render's external Postgres URL requires SSL. Internal URLs may not.
// Set DATABASE_SSL=false only if connecting without SSL.
const ssl =
  process.env.DATABASE_SSL === "false"
    ? false
    : { rejectUnauthorized: false };

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl,
});

export function query(text, params) {
  return pool.query(text, params);
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
