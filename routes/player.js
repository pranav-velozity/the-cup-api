import { Router } from "express";
import {
  requireAuth,
  attachClerkUser,
  primaryPhone,
} from "../middleware/auth.js";
import { query } from "../db/pool.js";
import { toE164, cleanLoose, phoneKey } from "../lib/phone.js";
import { ensureRegistrations } from "../lib/registrations.js";

const router = Router();
router.use(requireAuth, attachClerkUser);

// Join a tournament. The player's Clerk-verified phone must be on the roster.
router.post("/join", async (req, res, next) => {
  try {
    const code = String(req.body?.code || "").trim();
    const name = String(req.body?.name || "").trim();
    if (!code)
      return res.status(400).json({ error: "Tournament code required" });

    const rawPhone = primaryPhone(req.clerkUser);
    const phone = toE164(rawPhone) || cleanLoose(rawPhone);
    const key = phoneKey(rawPhone);
    if (!phone || !key)
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

    // Forgiving match on the last 9 digits (handles +61/0/+1/format differences).
    const { rows: roster } = await query(
      `SELECT * FROM roster_entries WHERE tournament_id=$1`,
      [t.id]
    );
    const entry = roster.find((e) => phoneKey(e.phone) === key);
    if (!entry)
      return res.status(403).json({
        error: `Your number ${phone} isn't on the roster — ask your organizer to add it`,
        yourPhone: phone,
        yourKey: key,
      });

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

// Diagnose a join: shows the phone we detected for you and the roster keys,
// so a mismatch is obvious. (Numbers are only visible to the signed-in user.)
router.get("/diagnose", async (req, res, next) => {
  try {
    const code = String(req.query.code || "").trim();
    const rawPhone = primaryPhone(req.clerkUser);
    const key = phoneKey(rawPhone);
    const out = { yourPhone: rawPhone, yourKey: key, tournamentFound: false };
    const { rows: tRows } = await query(`SELECT id, code, name FROM tournaments WHERE code=$1`, [code]);
    const t = tRows[0];
    if (t) {
      out.tournamentFound = true;
      out.tournamentName = t.name;
      const { rows: roster } = await query(
        `SELECT planned_name, phone FROM roster_entries WHERE tournament_id=$1`, [t.id]
      );
      out.rosterCount = roster.length;
      out.roster = roster.map((r) => ({ name: r.planned_name, phone: r.phone, key: phoneKey(r.phone) }));
      out.matched = roster.some((r) => phoneKey(r.phone) === key);
    }
    res.json(out);
  } catch (e) {
    next(e);
  }
});

// Tournaments this user has joined as a player (for the Home "Playing in" list).
router.get("/tournaments", async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT t.* FROM tournaments t
       JOIN registrations r ON r.tournament_id = t.id
       WHERE r.player_clerk_id = $1
       ORDER BY t.created_at DESC`,
      [req.userId]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// ---- push notifications --------------------------------------------------

// Subscribe this device to push for every tournament the user plays in.
// Body: { subscription: { endpoint, keys: { p256dh, auth } } }
router.post("/push/subscribe", async (req, res, next) => {
  try {
    const sub = req.body?.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth)
      return res.status(400).json({ error: "Invalid subscription" });

    // Make sure the user is registered everywhere their phone is on a roster
    // (e.g. organizers playing in their own tournament), so push reaches them.
    await ensureRegistrations(req.userId, primaryPhone(req.clerkUser));

    const { rows: regs } = await query(
      `SELECT id FROM registrations WHERE player_clerk_id = $1`, [req.userId]
    );
    if (!regs.length) return res.json({ linked: 0 });

    for (const r of regs) {
      await query(
        `INSERT INTO push_subscriptions (registration_id, endpoint, p256dh, auth)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (registration_id, endpoint)
           DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
        [r.id, sub.endpoint, sub.keys.p256dh, sub.keys.auth]
      );
    }
    res.json({ linked: regs.length });
  } catch (e) {
    next(e);
  }
});

router.post("/push/unsubscribe", async (req, res, next) => {
  try {
    const endpoint = req.body?.endpoint;
    if (!endpoint) return res.status(400).json({ error: "endpoint required" });
    await query(
      `DELETE FROM push_subscriptions ps USING registrations r
        WHERE ps.registration_id = r.id AND r.player_clerk_id = $1 AND ps.endpoint = $2`,
      [req.userId, endpoint]
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// In-app feed: notifications across the tournaments this user plays in.
router.get("/notifications", async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT n.id, n.type, n.title, n.body, n.created_at, t.name AS tournament_name, t.code AS tournament_code
         FROM notifications n
         JOIN tournaments t ON t.id = n.tournament_id
        WHERE n.tournament_id IN (
              SELECT tournament_id FROM registrations WHERE player_clerk_id = $1)
          AND n.audience = 'all'
        ORDER BY n.created_at DESC
        LIMIT 50`,
      [req.userId]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

export default router;
