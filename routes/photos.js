import { Router } from "express";
import { randomUUID } from "crypto";
import { query } from "../db/pool.js";
import { requireAuth, attachClerkUser, primaryPhone } from "../middleware/auth.js";
import { ensureRegistrations } from "../lib/registrations.js";
import { r2Configured, signPutUrl, publicUrl, keyFromUrl, deleteObject } from "../lib/r2.js";

const router = Router();
// NOTE: mounted at /api ahead of other routers — auth must be per-route so
// unrelated /api/* traffic (public routes) passes through untouched.

async function byCode(code) {
  const { rows } = await query(`SELECT * FROM tournaments WHERE code = $1`, [code]);
  return rows[0] || null;
}

// Players + the organizer can add photos; anyone with the code can look.
async function canContribute(t, userId) {
  if (t.organizer_clerk_id === userId) return true;
  const { rows } = await query(
    `SELECT 1 FROM registrations WHERE tournament_id = $1 AND player_clerk_id = $2`,
    [t.id, userId]
  );
  return !!rows[0];
}

// GET /api/score/:code/photos — newest first
router.get("/score/:code/photos", requireAuth, attachClerkUser, async (req, res, next) => {
  try {
    const t = await byCode(req.params.code);
    if (!t) return res.status(404).json({ error: "Tournament not found" });
    await ensureRegistrations(req.userId, primaryPhone(req.clerkUser));
    const { rows } = await query(
      `SELECT id, uploader_clerk_id, uploader_name, url, thumb_url, created_at
         FROM photos WHERE tournament_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [t.id]
    );
    const canUpload = await canContribute(t, req.userId);
    res.json({
      photos: rows.map((p) => ({ ...p, mine: p.uploader_clerk_id === req.userId })),
      canUpload,
      canModerate: t.organizer_clerk_id === req.userId,
      configured: r2Configured(),
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/score/:code/photos/sign — presigned PUT urls for image + thumb
router.post("/score/:code/photos/sign", requireAuth, attachClerkUser, async (req, res, next) => {
  try {
    if (!r2Configured())
      return res.status(501).json({ error: "Photo storage isn't set up yet — ask the admin" });
    const t = await byCode(req.params.code);
    if (!t) return res.status(404).json({ error: "Tournament not found" });
    await ensureRegistrations(req.userId, primaryPhone(req.clerkUser));
    if (!(await canContribute(t, req.userId)))
      return res.status(403).json({ error: "Only players in this tournament can add photos" });

    const id = randomUUID();
    const key = `photos/${t.id}/${id}.jpg`;
    const tkey = `photos/${t.id}/${id}_t.jpg`;
    res.json({
      uploadUrl: signPutUrl(key),
      thumbUploadUrl: signPutUrl(tkey),
      url: publicUrl(key),
      thumbUrl: publicUrl(tkey),
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/score/:code/photos — register a completed upload
router.post("/score/:code/photos", requireAuth, attachClerkUser, async (req, res, next) => {
  try {
    const t = await byCode(req.params.code);
    if (!t) return res.status(404).json({ error: "Tournament not found" });
    if (!(await canContribute(t, req.userId)))
      return res.status(403).json({ error: "Only players in this tournament can add photos" });

    const { url, thumbUrl } = req.body || {};
    // Only accept URLs inside our bucket — no arbitrary link injection.
    if (!keyFromUrl(url)) return res.status(400).json({ error: "Bad photo URL" });
    const name =
      [req.clerkUser?.firstName, req.clerkUser?.lastName].filter(Boolean).join(" ") || null;

    const { rows } = await query(
      `INSERT INTO photos (tournament_id, uploader_clerk_id, uploader_name, url, thumb_url)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, uploader_name, url, thumb_url, created_at`,
      [t.id, req.userId, name, url, keyFromUrl(thumbUrl) ? thumbUrl : null]
    );
    res.json({ ...rows[0], mine: true });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/photos/:id — your own, or any as organizer
router.delete("/photos/:id", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.*, t.organizer_clerk_id FROM photos p
        JOIN tournaments t ON t.id = p.tournament_id WHERE p.id = $1`,
      [req.params.id]
    );
    const p = rows[0];
    if (!p) return res.status(404).json({ error: "Photo not found" });
    if (p.uploader_clerk_id !== req.userId && p.organizer_clerk_id !== req.userId)
      return res.status(403).json({ error: "You can only delete your own photos" });

    await query(`DELETE FROM photos WHERE id = $1`, [req.params.id]);
    for (const u of [p.url, p.thumb_url]) {
      const k = keyFromUrl(u);
      if (k) deleteObject(k); // best-effort, fire and forget
    }
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
