import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAdmin } from "../middleware/auth.js";
import { query } from "../db/pool.js";
import { uniqueCode } from "../lib/codes.js";
import { notifyUser } from "../lib/notify.js";
import { getSetting, setSetting } from "../lib/settings.js";

const router = Router();

// Admin actions are low-volume; cap them.
const limiter = rateLimit({ windowMs: 60_000, max: 30 });
router.use(limiter, requireAdmin);

// Record every admin so we can fan out admin notifications to them later.
router.use(async (req, _res, next) => {
  query(`INSERT INTO admins (clerk_id) VALUES ($1) ON CONFLICT (clerk_id) DO UPDATE SET seen_at = now()`, [req.userId])
    .catch(() => {});
  next();
});

// Mint a new single-use gate pass.
router.post("/gate-passes", async (req, res, next) => {
  try {
    const note = req.body?.note ?? null;
    const code = await uniqueCode("gate_passes");
    const { rows } = await query(
      `INSERT INTO gate_passes (code, created_by_clerk_id, note)
       VALUES ($1, $2, $3)
       RETURNING id, code, status, note, created_at`,
      [code, req.userId, note]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

// List all gate passes with their status and linked tournament (if any).
router.get("/gate-passes", async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT g.id, g.code, g.status, g.note, g.requested_by, g.created_at, g.claimed_at,
              g.tournament_id, t.name AS tournament_name, t.code AS tournament_code
       FROM gate_passes g
       LEFT JOIN tournaments t ON t.id = g.tournament_id
       ORDER BY g.created_at DESC`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// Revoke an unused pass (claimed passes can't be revoked).
router.post("/gate-passes/:id/revoke", async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE gate_passes SET status = 'revoked'
       WHERE id = $1 AND status = 'unused'
       RETURNING id, code, status`,
      [req.params.id]
    );
    if (!rows.length) {
      return res
        .status(409)
        .json({ error: "Only unused passes can be revoked" });
    }
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

// Full read-only detail for any tournament (admin oversight).
router.get("/tournaments/:id", async (req, res, next) => {
  try {
    const { rows: trows } = await query(`SELECT * FROM tournaments WHERE id = $1`, [req.params.id]);
    const t = trows[0];
    if (!t) return res.status(404).json({ error: "Tournament not found" });

    const [{ rows: days }, { rows: roster }, { rows: matches }, { rows: registrations }] =
      await Promise.all([
        query(`SELECT * FROM tournament_days WHERE tournament_id=$1 ORDER BY day_index`, [t.id]),
        query(`SELECT * FROM roster_entries WHERE tournament_id=$1 ORDER BY team, created_at`, [t.id]),
        query(`SELECT * FROM matches WHERE tournament_id=$1 ORDER BY day_index, ordinal`, [t.id]),
        query(`SELECT id, name, phone, team, notify_enabled, created_at FROM registrations WHERE tournament_id=$1`, [t.id]),
      ]);
    res.json({ ...t, days, roster, matches, registrations });
  } catch (e) {
    next(e);
  }
});

// Approve a pending request -> the pass becomes usable; tell the organizer.
router.post("/gate-passes/:id/approve", async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE gate_passes SET status = 'unused'
       WHERE id = $1 AND status = 'pending'
       RETURNING id, code, requested_by, requested_by_clerk_id`,
      [req.params.id]
    );
    if (!rows.length) return res.status(409).json({ error: "Only pending requests can be approved" });
    const p = rows[0];
    await notifyUser(p.requested_by_clerk_id, {
      type: "pass_approved",
      title: "Gate pass approved 🎉",
      body: `You're cleared to create a tournament. Your access code is ${p.code}.`,
      data: { code: p.code },
    }).catch((e) => console.error("[notifyUser]", e.message));
    res.json(p);
  } catch (e) {
    next(e);
  }
});

// Decline a pending request; tell the organizer.
router.post("/gate-passes/:id/reject", async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE gate_passes SET status = 'rejected'
       WHERE id = $1 AND status = 'pending'
       RETURNING id, requested_by, requested_by_clerk_id`,
      [req.params.id]
    );
    if (!rows.length) return res.status(409).json({ error: "Only pending requests can be declined" });
    const p = rows[0];
    await notifyUser(p.requested_by_clerk_id, {
      type: "pass_rejected",
      title: "Gate pass request declined",
      body: "Your request to create a tournament wasn't approved. Reach out if you think this is a mistake.",
    }).catch((e) => console.error("[notifyUser]", e.message));
    res.json(p);
  } catch (e) {
    next(e);
  }
});

// Free-for-all toggle: ON => self-serve codes, OFF => admin approval.
router.get("/settings", async (req, res, next) => {
  try { res.json({ freeForAll: (await getSetting("free_for_all", "true")) === "true" }); }
  catch (e) { next(e); }
});
router.post("/settings", async (req, res, next) => {
  try {
    if (typeof req.body?.freeForAll === "boolean") await setSetting("free_for_all", req.body.freeForAll);
    res.json({ freeForAll: (await getSetting("free_for_all", "true")) === "true" });
  } catch (e) {
    next(e);
  }
});

export default router;
