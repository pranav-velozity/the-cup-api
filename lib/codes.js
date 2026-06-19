import { query } from "../db/pool.js";

function rand5() {
  return String(Math.floor(Math.random() * 100000)).padStart(5, "0");
}

// Allocate a 5-digit code that isn't already in use in the given table.
// table is one of our own fixed values ('gate_passes' | 'tournaments').
export async function uniqueCode(table) {
  for (let i = 0; i < 25; i++) {
    const code = rand5();
    const { rows } = await query(`SELECT 1 FROM ${table} WHERE code = $1`, [
      code,
    ]);
    if (rows.length === 0) return code;
  }
  throw Object.assign(new Error("Could not allocate a unique code"), {
    status: 503,
  });
}
