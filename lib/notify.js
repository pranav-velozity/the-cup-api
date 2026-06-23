import { query } from "../db/pool.js";
import { sendPush, pushConfigured } from "./push.js";

// Store an in-app notification and fan out web push to the tournament's
// subscribed players. Failures are swallowed per-subscription so one dead
// endpoint never blocks the rest.
export async function notify(tournament, { type, title, body, matchId = null }) {
  await query(
    `INSERT INTO notifications (tournament_id, type, audience, match_id, title, body)
     VALUES ($1,$2,'all',$3,$4,$5)`,
    [tournament.id, type, matchId, title, body]
  );

  if (!pushConfigured()) return;

  const { rows: subs } = await query(
    `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
       FROM push_subscriptions ps
       JOIN registrations r ON r.id = ps.registration_id
      WHERE r.tournament_id = $1 AND r.notify_enabled = true`,
    [tournament.id]
  );

  const payload = { title, body, url: `/?code=${tournament.code}`, tag: `${type}:${matchId || tournament.id}` };
  await Promise.all(
    subs.map(async (s) => {
      const r = await sendPush(s, payload);
      if (r === "gone") await query(`DELETE FROM push_subscriptions WHERE id=$1`, [s.id]).catch(() => {});
    })
  );
}

// Diff two board snapshots to find newsworthy transitions.
export function detectEvents(before, after) {
  const evts = [];
  const beforeById = Object.fromEntries((before.matches || []).map((m) => [m.id, m]));

  // 1) matches that just finished
  for (const m of after.matches || []) {
    const b = beforeById[m.id];
    if (b && !b.done && m.done) {
      const win = m.pointsA > m.pointsB ? m.nameA : m.pointsB > m.pointsA ? m.nameB : null;
      evts.push({
        type: "match_final",
        matchId: m.id,
        title: "Match decided",
        body: win ? `${win} closed it out (${m.nameA} v ${m.nameB})` : `${m.nameA} v ${m.nameB} ended all square`,
      });
    }
  }

  // 2) overall lead change (to a clear leader)
  const lead = (bd) => (bd.teamA.points > bd.teamB.points ? "A" : bd.teamB.points > bd.teamA.points ? "B" : "T");
  const lb = lead(before), la = lead(after);
  if (la !== "T" && la !== lb) {
    const team = la === "A" ? after.teamA : after.teamB;
    evts.push({
      type: "lead_change",
      title: "Lead change",
      body: `${team.name} now lead ${after.teamA.points}–${after.teamB.points}`,
    });
  }

  // 3) a day completing
  const tally = (bd) => {
    const d = {};
    for (const m of bd.matches || []) { (d[m.dayIndex] ||= { tot: 0, done: 0 }); d[m.dayIndex].tot++; if (m.done) d[m.dayIndex].done++; }
    return d;
  };
  const da = tally(after), db = tally(before);
  for (const k of Object.keys(da)) {
    const a = da[k], b = db[k];
    if (a.tot > 0 && a.done === a.tot && (!b || b.done < b.tot)) {
      evts.push({
        type: "day_end",
        title: "Day complete",
        body: `Day ${+k + 1} is done — ${after.teamA.name} ${after.teamA.points}, ${after.teamB.name} ${after.teamB.points}`,
      });
    }
  }

  return evts;
}
