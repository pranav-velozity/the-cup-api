import { Router } from "express";
import {
  requireAuth,
  attachClerkUser,
  primaryPhone,
} from "../middleware/auth.js";
import { query } from "../db/pool.js";
import { toE164 } from "../lib/phone.js";

const router = Router();
router.use(requireAuth, attachClerkUser);

// Join a tournament. The player's Clerk-verified phone must be on the roster.
router.post("/join", async (req, res, next) => {
  try {
    const code = String(req.body?.code || "").trim();
    const name = String(req.body?.name || "").trim();
    if (!code)
      return res.status(400).json({ error: "Tournament code required" });

    const phone = toE164(primaryPhone(req.clerkUser));
    if (!phone)
      return res
        .status(400)
        .json({ error: "Your account has no verified phone number" });

    const { rows: tRows } = await query(
      `SELECT * FROM tournaments WHERE code = $1`,
      [code]
    );
    const t = tRows[0];
    if (!t)
      return res.status(404).json({ error: "No tournament with that code" });

    const { rows: entries } = await query(
      `SELECT * FROM roster_entries WHERE tournament_id=$1 AND phone=$2`,
      [t.id, phone]
    );
    if (!entries.length)
      return res.status(403).json({
        error:
          "Your number isn't on the roster — ask your organizer to add you",
      });
    const entry = entries[0];

    const { rows } = await query(
      `INSERT INTO registrations
         (tournament_id, roster_entry_id, name, phone, team, player_clerk_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tournament_id, phone)
         DO UPDATE SET name = EXCLUDED.name, player_clerk_id = EXCLUDED.player_clerk_id
       RETURNING *`,
      [
        t.id,
        entry.id,
        name || entry.planned_name || "Player",
        phone,
        entry.team,
        req.userId,
      ]
    );

    res.status(201).json({
      registration: rows[0],
      tournament: { id: t.id, code: t.code, name: t.name },
    });
  } catch (e) {
    next(e);
  }
});

// My registration in a tournament (by code).
router.get("/me", async (req, res, next) => {
  try {
    const code = String(req.query.code || "").trim();
    const { rows: tRows } = await query(
      `SELECT id FROM tournaments WHERE code = $1`,
      [code]
    );
    if (!tRows.length)
      return res.status(404).json({ error: "No tournament with that code" });

    const { rows } = await query(
      `SELECT * FROM registrations WHERE tournament_id=$1 AND player_clerk_id=$2`,
      [tRows[0].id, req.userId]
    );
    if (!rows.length)
      return res.status(404).json({ error: "Not registered" });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

// Update my display name / notification master switch.
router.patch("/registrations/:id", async (req, res, next) => {
  try {
    const f = req.body || {};
    const { rows } = await query(
      `UPDATE registrations SET
         name = COALESCE($3, name),
         notify_enabled = COALESCE($4, notify_enabled)
       WHERE id = $1 AND player_clerk_id = $2
       RETURNING *`,
      [
        req.params.id,
        req.userId,
        f.name ?? null,
        typeof f.notifyEnabled === "boolean" ? f.notifyEnabled : null,
      ]
    );
    if (!rows.length)
      return res.status(404).json({ error: "Registration not found" });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

export default router;
