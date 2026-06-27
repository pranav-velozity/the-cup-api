// ============================================================
//  Scoring + board routes
//
//  - GET  /api/score/:code/board                 live board snapshot
//  - PUT  /api/score/matches/:matchId/holes/:n   score one hole (offline-safe)
//  - PUT  /api/score/batch                        flush an outbox of writes
//
//  Writes are idempotent upserts keyed by (match_id, hole) with
//  last-writer-wins by client timestamp, so retries and out-of-order
//  delivery from a flaky course connection can never corrupt state.
// ============================================================

import { Router } from "express";
import { requireAuth, attachClerkUser, primaryPhone } from "../middleware/auth.js";
import { query, withTransaction } from "../db/pool.js";
import { ensureRegistrations } from "../lib/registrations.js";
import { deriveBoard } from "../lib/scoring.js";
import { emitBoard, emitEvent } from "../lib/realtime.js";
import { notify, detectEvents } from "../lib/notify.js";

const router = Router();
router.use(requireAuth, attachClerkUser);

// ---- load helpers --------------------------------------------------------

async function loadTournamentByCode(code) {
  const { rows } = await query(`SELECT * FROM tournaments WHERE code = $1`, [code]);
  return rows[0] || null;
}

async function loadNamesById(tournamentId) {
  const [{ rows: roster }, { rows: regs }] = await Promise.all([
    query(`SELECT id, planned_name FROM roster_entries WHERE tournament_id = $1`, [tournamentId]),
    query(`SELECT roster_entry_id, name FROM registrations WHERE tournament_id = $1`, [tournamentId]),
  ]);
  const names = {};
  for (const r of roster) names[r.id] = r.planned_name || null;
  for (const g of regs) if (g.roster_entry_id) names[g.roster_entry_id] = g.name; // joined name wins
  return names;
}

// Assemble + derive the full board for a tournament row.
async function buildBoard(t) {
  const [{ rows: days }, { rows: matches }, { rows: holes }, { rows: events }, namesById] =
    await Promise.all([
      query(`SELECT * FROM tournament_days WHERE tournament_id = $1 ORDER BY day_index`, [t.id]),
      query(`SELECT * FROM matches WHERE tournament_id = $1 ORDER BY day_index, ordinal`, [t.id]),
      query(
        `SELECT hr.match_id, hr.hole, hr.result, hr.strokes_a, hr.strokes_b
           FROM hole_results hr
           JOIN matches m ON m.id = hr.match_id
          WHERE m.tournament_id = $1`,
        [t.id]
      ),
      query(
        `SELECT text, dot, match_id, created_at
           FROM match_events WHERE tournament_id = $1
          ORDER BY created_at DESC LIMIT 14`,
        [t.id]
      ),
      loadNamesById(t.id),
    ]);

  const holesByMatch = {};
  for (const h of holes) (holesByMatch[h.match_id] ||= []).push(h);

  const board = deriveBoard({ tournament: t, days, matches, holesByMatch, namesById, events });
  return { board, events };
}

// ---- permission ----------------------------------------------------------

// Which matches (if any) is this user playing in, and on which side?
// Used to surface a "your match" quick-link and to scope stroke entry.
async function findUserMatches(userId, tournamentId) {
  const { rows } = await query(
    `SELECT roster_entry_id FROM registrations WHERE tournament_id = $1 AND player_clerk_id = $2`,
    [tournamentId, userId]
  );
  const reId = rows[0]?.roster_entry_id;
  if (!reId) return [];
  const { rows: ms } = await query(
    `SELECT id, side_a, side_b FROM matches WHERE tournament_id = $1 ORDER BY day_index, ordinal`,
    [tournamentId]
  );
  const out = [];
  for (const m of ms) {
    const inA = (m.side_a || []).map(String).includes(String(reId));
    const inB = (m.side_b || []).map(String).includes(String(reId));
    if (inA || inB) out.push({ id: m.id, side: inA ? "A" : "B" });
  }
  return out;
}

// Can this user score this match? Organizer => any match in their tournament.
// Player => only a match they're in (their roster_entry_id on either side).
async function canScore(userId, match, tournament) {
  if (tournament.organizer_clerk_id === userId) return true;
  const { rows } = await query(
    `SELECT roster_entry_id FROM registrations
      WHERE tournament_id = $1 AND player_clerk_id = $2`,
    [tournament.id, userId]
  );
  const reId = rows[0]?.roster_entry_id;
  if (!reId) return false;
  const ids = [...(match.side_a || []), ...(match.side_b || [])].map(String);
  return ids.includes(String(reId));
}

// ---- the offline-safe upsert --------------------------------------------

function safeTs(v) {
  const d = v ? new Date(v) : new Date();
  return isNaN(d.getTime()) ? new Date() : d;
}

// Apply one hole write inside a transaction client. Returns the written row
// (or null if a newer value already won). Appends a ticker event on change.
async function applyHole(c, { match, tournament, hole, result, clientTs, updatedBy, namesById }) {
  const ts = safeTs(clientTs);
  const res = ["A", "B", "T"].includes(result) ? result : null;

  const { rows } = await c.query(
    `INSERT INTO hole_results (match_id, hole, result, updated_by, client_ts, updated_at)
     VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (match_id, hole) DO UPDATE
       SET result = EXCLUDED.result,
           updated_by = EXCLUDED.updated_by,
           client_ts = EXCLUDED.client_ts,
           updated_at = now()
       WHERE EXCLUDED.client_ts >= hole_results.client_ts
     RETURNING *`,
    [match.id, hole, res, updatedBy, ts.toISOString()]
  );

  // No row => a newer client_ts already stored. Idempotent success, no event.
  if (!rows.length) return null;

  // Build a ticker event for this change (skip pure clears).
  if (res) {
    const nm = (side) =>
      (side || []).map((id) => namesById[id]).filter(Boolean).join(" & ");
    const nameA = nm(match.side_a) || tournament.team_a_name;
    const nameB = nm(match.side_b) || tournament.team_b_name;
    const winner = res === "A" ? nameA : res === "B" ? nameB : null;
    const text =
      `${nameA} v ${nameB} · ` +
      (winner ? `hole ${hole} to ${winner}` : `hole ${hole} halved`);
    const dot =
      res === "A" ? tournament.team_a_color : res === "B" ? tournament.team_b_color : null;
    await c.query(
      `INSERT INTO match_events (tournament_id, match_id, hole, text, dot)
       VALUES ($1,$2,$3,$4,$5)`,
      [tournament.id, match.id, hole, text, dot]
    );
  }
  return rows[0];
}

// Apply one stroke-diff write (one pair's strokes for one hole). Each side has
// its own LWW clock so the two pairs sharing a hole row never clobber each
// other. strokes=null clears that side. No ticker event (board-level only).
async function applyStroke(c, { match, hole, side, strokes, clientTs }) {
  const ts = safeTs(clientTs);
  const val = Number.isFinite(strokes) && strokes >= 1 && strokes <= 30 ? Math.round(strokes) : null;
  const col = side === "B" ? "strokes_b" : "strokes_a";
  const tcol = side === "B" ? "client_ts_b" : "client_ts_a";

  const { rows } = await c.query(
    `INSERT INTO hole_results (match_id, hole, ${col}, ${tcol}, updated_at)
     VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (match_id, hole) DO UPDATE
       SET ${col} = EXCLUDED.${col},
           ${tcol} = EXCLUDED.${tcol},
           updated_at = now()
       WHERE hole_results.${tcol} IS NULL OR EXCLUDED.${tcol} >= hole_results.${tcol}
     RETURNING *`,
    [match.id, hole, val, ts.toISOString()]
  );
  return rows[0] || null;
}

// ---- routes --------------------------------------------------------------

// Live board snapshot for a tournament code.
router.get("/:code/board", async (req, res, next) => {
  try {
    const t = await loadTournamentByCode(String(req.params.code).trim());
    if (!t) return res.status(404).json({ error: "No tournament with that code" });
    const { board } = await buildBoard(t);
    // Auto-link organizers/players who are on the roster but never formally
    // joined, so the "your match" pill resolves for their own tournaments too.
    await ensureRegistrations(req.userId, primaryPhone(req.clerkUser));
    const mine = await findUserMatches(req.userId, t.id);
    board.yourMatchIds = mine.map((x) => x.id);
    board.yourSides = Object.fromEntries(mine.map((x) => [x.id, x.side]));
    board.canScoreAll = t.organizer_clerk_id === req.userId;
    res.json(board);
  } catch (e) {
    next(e);
  }
});

// Score a single hole.
router.put("/matches/:matchId/holes/:hole", async (req, res, next) => {
  try {
    const hole = parseInt(req.params.hole, 10);
    if (!(hole >= 1 && hole <= 18))
      return res.status(400).json({ error: "hole must be 1..18" });

    const { rows: mRows } = await query(`SELECT * FROM matches WHERE id = $1`, [req.params.matchId]);
    const match = mRows[0];
    if (!match) return res.status(404).json({ error: "Match not found" });

    const { rows: tRows } = await query(`SELECT * FROM tournaments WHERE id = $1`, [match.tournament_id]);
    const tournament = tRows[0];

    if (!(await canScore(req.userId, match, tournament)))
      return res.status(403).json({ error: "You can only score your own match" });

    const isStroke = req.body?.side === "A" || req.body?.side === "B";

    // For stroke-diff, a player may only enter their OWN pair's side.
    if (isStroke && tournament.organizer_clerk_id !== req.userId) {
      const { rows } = await query(
        `SELECT roster_entry_id FROM registrations WHERE tournament_id = $1 AND player_clerk_id = $2`,
        [tournament.id, req.userId]
      );
      const reId = String(rows[0]?.roster_entry_id);
      const userSide = (match.side_a || []).map(String).includes(reId) ? "A"
        : (match.side_b || []).map(String).includes(reId) ? "B" : null;
      if (userSide !== req.body.side)
        return res.status(403).json({ error: "You can only enter your own pair's score" });
    }

    const namesById = await loadNamesById(tournament.id);

    // Snapshot before the write so we can detect newsworthy transitions.
    const { board: beforeBoard } = await buildBoard(tournament);

    await withTransaction((c) =>
      isStroke
        ? applyStroke(c, { match, hole, side: req.body.side, strokes: Number(req.body.strokes), clientTs: req.body?.clientTs })
        : applyHole(c, {
            match,
            tournament,
            hole,
            result: req.body?.result ?? null,
            clientTs: req.body?.clientTs,
            updatedBy: req.userId,
            namesById,
          })
    );

    const { board, events } = await buildBoard(tournament);
    emitBoard(tournament.code, board);
    if (events[0]) emitEvent(tournament.code, events[0]);

    // Fire notifications for match-final / lead-change / day-end transitions.
    for (const e of detectEvents(beforeBoard, board)) {
      notify(tournament, e).catch((err) => console.error("[notify]", err.message));
    }

    res.json(board);
  } catch (e) {
    next(e);
  }
});

// Flush an outbox: { writes: [{ matchId, hole, result, clientTs }] }.
// Permission is checked per match; touched tournaments are recomputed once.
router.put("/batch", async (req, res, next) => {
  try {
    const writes = Array.isArray(req.body?.writes) ? req.body.writes : [];
    if (!writes.length) return res.status(400).json({ error: "writes array required" });
    if (writes.length > 200) return res.status(413).json({ error: "Too many writes (max 200)" });

    const matchCache = {};
    const tourCache = {};
    const namesCache = {};
    const regCache = {};
    const touched = {};
    const accepted = [];
    const rejected = [];

    // Snapshot before-boards for any tournament these writes touch.
    const beforeBoards = {};
    {
      const matchIds = [...new Set(writes.map((w) => w.matchId).filter(Boolean))];
      if (matchIds.length) {
        const { rows } = await query(
          `SELECT DISTINCT t.* FROM tournaments t JOIN matches m ON m.tournament_id = t.id WHERE m.id = ANY($1)`,
          [matchIds]
        );
        for (const t of rows) { const { board } = await buildBoard(t); beforeBoards[t.code] = board; }
      }
    }

    await withTransaction(async (c) => {
      for (const w of writes) {
        const hole = parseInt(w.hole, 10);
        if (!(hole >= 1 && hole <= 18)) { rejected.push({ ...w, reason: "bad hole" }); continue; }

        let match = matchCache[w.matchId];
        if (!match) {
          const { rows } = await c.query(`SELECT * FROM matches WHERE id = $1`, [w.matchId]);
          match = rows[0];
          matchCache[w.matchId] = match || null;
        }
        if (!match) { rejected.push({ ...w, reason: "no match" }); continue; }

        let tournament = tourCache[match.tournament_id];
        if (!tournament) {
          const { rows } = await c.query(`SELECT * FROM tournaments WHERE id = $1`, [match.tournament_id]);
          tournament = rows[0];
          tourCache[match.tournament_id] = tournament;
        }

        if (!(await canScore(req.userId, match, tournament))) {
          rejected.push({ ...w, reason: "forbidden" });
          continue;
        }

        const isStroke = w.side === "A" || w.side === "B";
        if (isStroke && tournament.organizer_clerk_id !== req.userId) {
          if (!(tournament.id in regCache)) {
            const { rows } = await c.query(
              `SELECT roster_entry_id FROM registrations WHERE tournament_id = $1 AND player_clerk_id = $2`,
              [tournament.id, req.userId]
            );
            regCache[tournament.id] = String(rows[0]?.roster_entry_id);
          }
          const reId = regCache[tournament.id];
          const userSide = (match.side_a || []).map(String).includes(reId) ? "A"
            : (match.side_b || []).map(String).includes(reId) ? "B" : null;
          if (userSide !== w.side) { rejected.push({ ...w, reason: "wrong side" }); continue; }
        }

        if (!namesCache[tournament.id]) namesCache[tournament.id] = await loadNamesById(tournament.id);

        if (isStroke) {
          await applyStroke(c, { match, hole, side: w.side, strokes: Number(w.strokes), clientTs: w.clientTs });
        } else {
          await applyHole(c, {
            match,
            tournament,
            hole,
            result: w.result ?? null,
            clientTs: w.clientTs,
            updatedBy: req.userId,
            namesById: namesCache[tournament.id],
          });
        }
        touched[tournament.code] = tournament;
        accepted.push({ matchId: w.matchId, hole });
      }
    });

    const boards = {};
    for (const code of Object.keys(touched)) {
      const { board } = await buildBoard(touched[code]);
      boards[code] = board;
      emitBoard(code, board);
      if (beforeBoards[code]) {
        for (const e of detectEvents(beforeBoards[code], board)) {
          notify(touched[code], e).catch((err) => console.error("[notify]", err.message));
        }
      }
    }

    res.json({ accepted, rejected, boards });
  } catch (e) {
    next(e);
  }
});

export default router;
