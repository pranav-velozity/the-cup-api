import { query } from "../db/pool.js";
import { phoneKey, toE164, cleanLoose } from "./phone.js";

// Auto-link a user to any roster spot that matches their verified phone but
// where no registration exists yet. This covers the case where someone (often
// the organizer) is ON the roster and paired into a match, but never went
// through the /join flow — so they previously had no registration, which meant
// no "your match" pill and no push notifications for their own tournament.
//
// Idempotent and safe to call on every relevant request. Returns count created.
export async function ensureRegistrations(userId, rawPhone) {
  const key = phoneKey(rawPhone);
  if (!key) return 0;
  const phone = toE164(rawPhone) || cleanLoose(rawPhone);

  // Roster spots whose last-9-digits match this user's phone, in tournaments
  // where they aren't registered yet.
  const { rows } = await query(
    `SELECT re.id, re.tournament_id, re.team, re.planned_name, re.phone
       FROM roster_entries re
      WHERE RIGHT(regexp_replace(re.phone, '\\D', '', 'g'), 9) = $1
        AND NOT EXISTS (
          SELECT 1 FROM registrations r
           WHERE r.tournament_id = re.tournament_id
             AND r.player_clerk_id = $2)`,
    [key, userId]
  );

  let created = 0;
  for (const e of rows) {
    try {
      await query(
        `INSERT INTO registrations
           (tournament_id, roster_entry_id, name, phone, team, player_clerk_id)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tournament_id, phone)
           DO UPDATE SET player_clerk_id = EXCLUDED.player_clerk_id,
                         roster_entry_id = EXCLUDED.roster_entry_id`,
        [e.tournament_id, e.id, e.planned_name || "Player", e.phone || phone, e.team, userId]
      );
      created++;
    } catch { /* one bad row shouldn't block the rest */ }
  }
  return created;
}
