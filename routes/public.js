import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { query } from "../db/pool.js";

const router = Router();

// Minimal info to render the join screen once a player enters a code.
// Requires sign-in so only authenticated players can probe codes.
router.get("/tournaments/:code/summary", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT code, name, team_a_name, team_a_color,
              team_b_name, team_b_color, status
       FROM tournaments WHERE code = $1`,
      [String(req.params.code).trim()]
    );
    if (!rows.length)
      return res.status(404).json({ error: "No tournament with that code" });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

export default router;
