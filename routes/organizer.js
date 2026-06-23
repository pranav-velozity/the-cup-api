import { Router } from "express";
import { requireAuth, attachClerkUser } from "../middleware/auth.js";
import { query, withTransaction } from "../db/pool.js";
import { uniqueCode } from "../lib/codes.js";
import { toE164, cleanLoose } from "../lib/phone.js";
import { notifyAdmins } from "../lib/notify.js";
import { isFreeForAll } from "../lib/settings.js";

const router = Router();
router.use(requireAuth, attachClerkUser);

// Assert the signed-in user owns this tournament; returns the row.
async function ownedTournament(id, userId) {
  const { rows } = await query(`SELECT * FROM tournaments WHERE id = $1`, [id]);
  const t = rows[0];
  if (!t) throw Object.assign(new Error("Tournament not found"), { status: 404 });
  if (t.organizer_clerk_id !== userId)
    throw Object.assign(new Error("Not your tournament"), { status: 403 });
  return t;
}

// Redeem a gate pass -> create a tournament + blank matches in one transaction.
router.post("/redeem", async (req, res, next) => {
  const { code, name, teamA, teamB, days } = req.body || {};
  if (!code || !name)
    return res.status(400).json({ error: "code and name are required" });

  // Normalize the day config (1..4 days). Fall back to the classic 2-day mix.
  const DEFAULT_DAYS = [
    { format: "singles", count: 18, pph: 1, playAll: true },
    { format: "scramble", count: 9, pph: 2, playAll: true },
  ];
  const clampInt = (v, def, lo, hi) =>
    Math.min(Math.max(parseInt(v ?? def, 10) || def, lo), hi);
  const cfg = (Array.isArray(days) && days.length ? days : DEFAULT_DAYS)
    .slice(0, 4)
    .map((d) => {
      const format = d.format === "scramble" ? "scramble" : "singles";
      return {
        format,
        count: clampInt(d.count, format === "scramble" ? 9 : 18, 1, 30),
        pph: clampInt(d.pph, format === "scramble" ? 2 : 1, 1, 10),
        playAll: d.playAll !== false,
      };
    });

  try {
    const tournament = await withTransaction(async (c) => {
      // Lock the pass row to prevent two organizers racing on the same code.
      const { rows: passes } = await c.query(
        `SELECT * FROM gate_passes WHERE code = $1 FOR UPDATE`,
        [String(code).trim()]
      );
      const pass = passes[0];
      if (!pass)
        throw Object.assign(new Error("Invalid gate pass"), { status: 404 });
      if (pass.status !== "unused")
        throw Object.assign(new Error("This gate pass has already been used"), {
          status: 409,
        });
      if (pass.expires_at && new Date(pass.expires_at) < new Date())
        throw Object.assign(new Error("This gate pass has expired"), {
          status: 409,
        });

      const tcode = await uniqueCode("tournaments");

      const { rows: tRows } = await c.query(
        `INSERT INTO tournaments
           (code, name, organizer_clerk_id, gate_pass_id,
            team_a_name, team_a_color, team_a_emoji, team_a_kind, team_a_logo_url,
            team_b_name, team_b_color, team_b_emoji, team_b_kind, team_b_logo_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [
          tcode,
          name,
          req.userId,
          pass.id,
          teamA?.name || "Team A",
          teamA?.color || "#2E7D5B",
          teamA?.emoji || null,
          teamA?.kind || "crest",
          teamA?.logoUrl || null,
          teamB?.name || "Team B",
          teamB?.color || "#B68A2E",
          teamB?.emoji || null,
          teamB?.kind || "crest",
          teamB?.logoUrl || null,
        ]
      );
      const t = tRows[0];

      await c.query(
        `UPDATE gate_passes
         SET status='claimed', claimed_by_clerk_id=$1, tournament_id=$2, claimed_at=now()
         WHERE id=$3`,
        [req.userId, t.id, pass.id]
      );

      // Create each day + its blank matches so scoring has rows to write into.
      for (let di = 0; di < cfg.length; di++) {
        const d = cfg[di];
        await c.query(
          `INSERT INTO tournament_days
             (tournament_id, day_index, format, points_per_hole, play_all)
           VALUES ($1,$2,$3,$4,$5)`,
          [t.id, di, d.format, d.pph, d.playAll]
        );
        const values = [];
        const params = [];
        let i = 1;
        for (let n = 1; n <= d.count; n++) {
          values.push(`($${i++},$${i++},$${i++},$${i++},$${i++})`);
          params.push(t.id, di, d.format, `Match ${n}`, n);
        }
        await c.query(
          `INSERT INTO matches (tournament_id, day_index, kind, label, ordinal)
           VALUES ${values.join(",")}`,
          params
        );
      }

      return t;
    });

    res.status(201).json(tournament);
  } catch (e) {
    next(e);
  }
});

// List tournaments I organize.
router.get("/tournaments", async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM tournaments WHERE organizer_clerk_id = $1 ORDER BY created_at DESC`,
      [req.userId]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// Full tournament detail (roster + matches + who has registered).
router.get("/tournaments/:id", async (req, res, next) => {
  try {
    const t = await ownedTournament(req.params.id, req.userId);
    const [{ rows: days }, { rows: roster }, { rows: matches }, { rows: registrations }] =
      await Promise.all([
        query(
          `SELECT * FROM tournament_days WHERE tournament_id=$1 ORDER BY day_index`,
          [t.id]
        ),
        query(
          `SELECT * FROM roster_entries WHERE tournament_id=$1 ORDER BY team, created_at`,
          [t.id]
        ),
        query(
          `SELECT * FROM matches WHERE tournament_id=$1 ORDER BY day_index, ordinal`,
          [t.id]
        ),
        query(
          `SELECT id, name, phone, team, notify_enabled, created_at
           FROM registrations WHERE tournament_id=$1`,
          [t.id]
        ),
      ]);
    res.json({ ...t, days, roster, matches, registrations });
  } catch (e) {
    next(e);
  }
});

// Update tournament settings (teams, notify settings, status).
router.patch("/tournaments/:id", async (req, res, next) => {
  try {
    await ownedTournament(req.params.id, req.userId);
    const f = req.body || {};
    const { rows } = await query(
      `UPDATE tournaments SET
         name = COALESCE($2, name),
         team_a_name = COALESCE($3, team_a_name),
         team_a_color = COALESCE($4, team_a_color),
         team_b_name = COALESCE($5, team_b_name),
         team_b_color = COALESCE($6, team_b_color),
         notify_settings = COALESCE($7, notify_settings),
         status = COALESCE($8, status)
       WHERE id = $1
       RETURNING *`,
      [
        req.params.id,
        f.name ?? null,
        f.teamA?.name ?? null,
        f.teamA?.color ?? null,
        f.teamB?.name ?? null,
        f.teamB?.color ?? null,
        f.notifySettings ? JSON.stringify(f.notifySettings) : null,
        f.status ?? null,
      ]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

// Add roster entries in bulk: { entries: [{ team, planned_name, phone }] }
router.post("/tournaments/:id/roster", async (req, res, next) => {
  try {
    await ownedTournament(req.params.id, req.userId);
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    if (!entries.length)
      return res.status(400).json({ error: "entries array required" });

    const out = [];
    const skipped = [];
    for (const e of entries) {
      try {
        const phone = toE164(e.phone) || cleanLoose(e.phone);
        if (!phone || !["A", "B"].includes(e.team)) {
          skipped.push(e);
          continue;
        }
        const { rows } = await query(
          `INSERT INTO roster_entries (tournament_id, team, planned_name, phone)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (tournament_id, phone)
             DO UPDATE SET team = EXCLUDED.team, planned_name = EXCLUDED.planned_name
           RETURNING *`,
          [req.params.id, e.team, e.planned_name || null, phone]
        );
        out.push(rows[0]);
      } catch (err) {
        skipped.push({ ...e, error: err.message });
      }
    }
    res.status(201).json({ added: out, skipped });
  } catch (e) {
    next(e);
  }
});

// Remove a roster entry.
router.delete("/tournaments/:id/roster/:entryId", async (req, res, next) => {
  try {
    await ownedTournament(req.params.id, req.userId);
    await query(
      `DELETE FROM roster_entries WHERE id=$1 AND tournament_id=$2`,
      [req.params.entryId, req.params.id]
    );
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// Update a match's label / player names: { label, sideA: [], sideB: [] }
router.patch("/tournaments/:id/matches/:matchId", async (req, res, next) => {
  try {
    await ownedTournament(req.params.id, req.userId);
    const f = req.body || {};
    const { rows } = await query(
      `UPDATE matches SET
         label = COALESCE($3, label),
         side_a = COALESCE($4, side_a),
         side_b = COALESCE($5, side_b)
       WHERE id = $1 AND tournament_id = $2
       RETURNING *`,
      [
        req.params.matchId,
        req.params.id,
        f.label ?? null,
        f.sideA ? JSON.stringify(f.sideA) : null,
        f.sideB ? JSON.stringify(f.sideB) : null,
      ]
    );
    if (!rows.length)
      return res.status(404).json({ error: "Match not found" });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

// Self-serve: a signed-in user without a gate pass requests one.
// Mints an unused pass tagged with their name so an admin sees who asked.
router.post("/request-access", async (req, res, next) => {
  const name = (req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Please enter your name." });
  try {
    // Free-for-all ON => issue a usable code instantly (self-serve).
    if (await isFreeForAll()) {
      const code = await uniqueCode("gate_passes");
      await query(
        `INSERT INTO gate_passes (code, status, created_by_clerk_id, requested_by, requested_by_clerk_id)
         VALUES ($1,'unused',$2,$3,$2)`,
        [code, req.userId, name]
      );
      return res.status(201).json({ code });
    }

    // Otherwise create a PENDING request — no usable code until an admin approves.
    const code = await uniqueCode("gate_passes");
    const { rows } = await query(
      `INSERT INTO gate_passes (code, status, created_by_clerk_id, requested_by, requested_by_clerk_id)
       VALUES ($1,'pending',$2,$3,$2)
       RETURNING id`,
      [code, req.userId, name]
    );
    await notifyAdmins({
      type: "pass_request",
      title: "New gate pass request",
      body: `${name} is requesting access to create a tournament.`,
      data: { passId: rows[0].id, requestedBy: name },
    }).catch((e) => console.error("[notifyAdmins]", e.message));

    res.status(201).json({ status: "pending" });
  } catch (e) {
    next(e);
  }
});

// Delete a tournament the organizer owns (and everything under it).
router.delete("/tournaments/:id", async (req, res, next) => {
  try {
    await ownedTournament(req.params.id, req.userId); // throws if not owner
    await withTransaction(async (c) => {
      // Release the gate pass FK (no cascade), then cascade-delete the rest.
      await c.query(`UPDATE gate_passes SET tournament_id=NULL WHERE tournament_id=$1`, [req.params.id]);
      await c.query(`DELETE FROM tournaments WHERE id=$1`, [req.params.id]);
    });
    res.json({ deleted: true });
  } catch (e) {
    next(e);
  }
});

export default router;
