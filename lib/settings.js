import { query } from "../db/pool.js";

export async function getSetting(key, def = null) {
  const { rows } = await query(`SELECT value FROM settings WHERE key = $1`, [key]);
  return rows.length ? rows[0].value : def;
}

export async function setSetting(key, value) {
  await query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, String(value)]
  );
}

// "Free for all" ON (default) => organizers self-serve a code instantly.
// OFF => requests go through admin approval.
export async function isFreeForAll() {
  return (await getSetting("free_for_all", "true")) === "true";
}
